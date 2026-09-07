import argparse
import contextlib
import io
import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from collector import Fetcher, Response, RobotsPolicy, COLLECTOR_VERSION, collect, extract, match_branch, public_addresses, valid_url
from pilot import connect, crawl, export, import_selection, safe_cell, reuse_results
from seed import choose, classify

SEED = {"id":"one","country":"US","name":"Excellent Bistro","lat":40.713,"lng":-74.006,"address":"10 Main Street",
        "region":"NY","locality":"New York","website":"https://bistro.example/","websites":["https://bistro.example/"],
        "confidence":.98,"brand":None,"market":"New York","selection_score":130,
        "selection_reason":"major_us_market","guide_tier":None,"guide_stars":0}


def document(**updates):
    node = {"@type":"Restaurant","name":"Excellent Bistro","address":{"streetAddress":"10 Main Street","addressRegion":"NY"},
            "geo":{"latitude":40.713,"longitude":-74.006},"servesCuisine":["French","Modern"],"priceRange":"$$$",
            "openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday"],"opens":"17:00","closes":"23:00"}]}
    node.update(updates)
    return node


def html(node):
    return '<html><script type="application/ld+json">'+json.dumps(node)+'</script></html>'


class ExtractionTests(unittest.TestCase):
    def test_graph_and_multiple_cuisines_preserve_evidence(self):
        facts,_ = extract(html({"@graph":[document()]}),SEED["website"],SEED)
        cuisine = next(f for f in facts if f["field"]=="cuisines")
        self.assertEqual(cuisine["value"],["French","Modern"])
        self.assertEqual(cuisine["branch_status"],"matched")
        self.assertEqual(cuisine["evidence_path"],"servesCuisine")
        self.assertEqual(cuisine["reuse_status"],"website_terms_unreviewed")

    def test_wrong_branch_rejected_even_same_brand(self):
        node = document(geo={"latitude":34.052,"longitude":-118.244})
        self.assertEqual(extract(html(node),SEED["website"],SEED)[0],[])

    def test_conflicting_street_overrides_nearby_coordinates(self):
        self.assertEqual(match_branch(document(address={"streetAddress":"12 Main Street"}),SEED),"conflicting_location")

    def test_name_alone_is_review_candidate(self):
        node = document(geo=None,address=None)
        self.assertEqual(match_branch(node,SEED),"needs_branch_review")

    def test_street_alone_cannot_match_another_city(self):
        node=document(geo=None,address={"streetAddress":"10 Main Street","addressLocality":"Albany","addressRegion":"NY"})
        self.assertEqual(match_branch(node,SEED),"needs_branch_review")
        node['address']['addressLocality']='New York'
        self.assertEqual(match_branch(node,SEED),"matched")

    def test_string_postal_addresses_match_city_and_street(self):
        node=document(geo=None,address='10 Main St\nNew York, NY, 10001\nUnited States')
        self.assertEqual(match_branch(node,SEED),'matched')
        self.assertEqual(match_branch(document(geo=None,address='10 Main St\nAlbany, NY, 12201'),SEED),'needs_branch_review')

    def test_empty_hours_placeholders_are_not_facts(self):
        for value in [', , , , , , ', {'dayOfWeek':'Monday','opens':'','closes':''}]:
            facts,_=extract(html(document(openingHoursSpecification=value)),SEED['website'],SEED)
            self.assertFalse(any(f['field']=='hours' for f in facts))

    def test_no_field_invention(self):
        facts,_ = extract(html({"@type":"Restaurant","name":SEED["name"]}),SEED["website"],SEED)
        self.assertEqual(facts,[])

    def test_unrelated_jsonld_ratings_and_photos_not_collected(self):
        node=document(aggregateRating={"ratingValue":5},image="https://x.example/a.jpg")
        fields={f["field"] for f in extract(html(node),SEED["website"],SEED)[0]}
        self.assertFalse({"rating","image","photos"} & fields)

    def test_invalid_jsonld_does_not_crash(self):
        facts,_=extract('<script type="application/ld+json">{broken</script>',SEED["website"],SEED)
        self.assertEqual(facts,[])

    def test_hours_text_not_auto_verified(self):
        facts,_=extract('<p>Opening hours: Monday to Friday 10am to 8pm.</p>',SEED["website"],SEED)
        self.assertEqual(facts[0]["branch_status"],"needs_branch_review")

    def test_generic_hours_heading_is_not_a_schedule(self):
        for text in ["Hours of operation +1 (813) 906-5445", "Hours of Operation Sign up for our newsletter"]:
            self.assertEqual(extract('<p>'+text+'</p>',SEED["website"],SEED)[0],[])

    def test_local_business_still_requires_branch_evidence(self):
        matched,_=extract(html(document(**{"@type":"LocalBusiness"})),SEED["website"],SEED)
        self.assertTrue(any(f["branch_status"]=="matched" for f in matched))
        wrong,_=extract(html(document(**{"@type":"LocalBusiness","address":{"streetAddress":"12 Main Street"}})),SEED["website"],SEED)
        self.assertEqual(wrong,[])


class NetworkPolicyTests(unittest.TestCase):
    def test_robot_wildcards_longest_rule_and_end_anchor(self):
        policy=RobotsPolicy()
        policy.parse(['User-agent: *','Disallow: /*?private=*','Disallow: /menu',
                      'Allow: /menu/public$', 'Disallow: /encoded/%61rea'])
        for path in ['/x?private=1', '/menu', '/menu/public/more', '/encoded/area']:
            self.assertFalse(policy.can_fetch('GoodEatsResearchBot','https://bistro.example'+path),path)
        self.assertTrue(policy.can_fetch('GoodEatsResearchBot','https://bistro.example/menu/public'))

    def test_robot_specific_groups_merge_and_allow_wins_tie(self):
        policy=RobotsPolicy()
        policy.parse(['User-agent: *','Disallow: /','User-agent: GoodEatsResearchBot','Disallow: /one',
                      'User-agent: GoodEatsResearchBot','Disallow: /two','Allow: /two'])
        self.assertTrue(policy.can_fetch('GoodEatsResearchBot','https://bistro.example/'))
        self.assertFalse(policy.can_fetch('GoodEatsResearchBot','https://bistro.example/one'))
        self.assertTrue(policy.can_fetch('GoodEatsResearchBot','https://bistro.example/two'))

    def test_private_and_directory_urls_rejected(self):
        for url in ["file:///etc/passwd","http://127.0.0.1/","http://169.254.169.254/","http://[::1]/",
                    "https://u:p@bistro.example/","http://localhost/","https://bistro.example:8080/",
                    "https://maps.google.com/","https://www.yelp.com/biz/x","https://bistro.internal/"]:
            with self.subTest(url=url),self.assertRaises(ValueError): valid_url(url)

    def test_mixed_public_private_dns_rejected(self):
        entries=[(socket.AF_INET,socket.SOCK_STREAM,6,"",("8.8.8.8",443)),
                 (socket.AF_INET,socket.SOCK_STREAM,6,"",("127.0.0.1",443))]
        with patch("socket.getaddrinfo",return_value=entries),self.assertRaisesRegex(ValueError,"private_dns"):
            public_addresses("bistro.example",443)

    def test_robot_disallow_no_page_fetch(self):
        fetcher=Fetcher("GoodEatsResearchBot/0.1",delay=0)
        calls=[]
        def fetch(url,*args):
            calls.append(url)
            return Response(url,200,{"content-type":"text/plain"},b"User-agent: *\nDisallow: /\n")
        with patch.object(fetcher,"_delayed",side_effect=fetch),self.assertRaisesRegex(ValueError,"robots_disallowed"):
            fetcher.get(SEED["website"])
        self.assertEqual(len(calls),1)

    def test_robot_failure_is_closed(self):
        fetcher=Fetcher("GoodEatsResearchBot/0.1")
        with patch.object(fetcher,"_delayed",return_value=Response(SEED["website"],503,{},b"")),self.assertRaisesRegex(ValueError,"robots_unavailable"):
            fetcher.get(SEED["website"])

    def test_robot_404_allows_page(self):
        fetcher=Fetcher("GoodEatsResearchBot/0.1")
        replies=[Response(SEED["website"]+"robots.txt",404,{},b""),Response(SEED["website"],200,{"content-type":"text/html"},b"ok")]
        with patch.object(fetcher,"_delayed",side_effect=replies):
            self.assertEqual(fetcher.get(SEED["website"]).body,b"ok")

    def test_redirect_cannot_leave_domain(self):
        fetcher=Fetcher("GoodEatsResearchBot/0.1")
        replies=[Response(SEED["website"]+"robots.txt",404,{},b""),Response(SEED["website"],302,{"location":"https://other.example/"},b"")]
        with patch.object(fetcher,"_delayed",side_effect=replies),self.assertRaisesRegex(ValueError,"external_redirect"):
            fetcher.get(SEED["website"])

    def test_crawl_delay_deferred_not_ignored(self):
        fetcher=Fetcher("GoodEatsResearchBot/0.1")
        response=Response(SEED["website"],200,{},b"User-agent: *\nCrawl-delay: 60\n")
        with patch.object(fetcher,"_delayed",return_value=response),self.assertRaisesRegex(ValueError,"deferred"):
            fetcher.get(SEED["website"])

    def test_budget_checked_before_connect(self):
        fetcher=Fetcher("GoodEatsResearchBot/0.1",max_requests=0)
        with patch("collector.public_addresses",return_value=[]),self.assertRaisesRegex(ValueError,"budget_exhausted"):
            fetcher._single(SEED["website"],100)

    def test_noindex_and_page_budget(self):
        fetcher=Fetcher("GoodEatsResearchBot/0.1")
        content=('<meta name="robots" content="noindex">'+html(document())).encode()
        with patch.object(fetcher,"get",return_value=Response(SEED["website"],200,{"content-type":"text/html"},content)) as get:
            result=collect(SEED,fetcher)
            self.assertEqual(result["observations"],[])
            self.assertEqual(get.call_count,1)


class SelectionTests(unittest.TestCase):
    def test_restaurants_are_default_with_explicit_cafe_opt_in(self):
        rows=[{**SEED,'id':'restaurant','category':'restaurant'},
              {**SEED,'id':'cafe','name':'Cafe','category':'coffee_shop'},
              {**SEED,'id':'acclaimed','name':'Acclaimed cafe','category':'cafe','guide_tier':'selected'}]
        self.assertEqual({r['id'] for r in choose(rows,10)},{'restaurant','acclaimed'})
        self.assertEqual(len(choose(rows,10,include_cafes=True)),3)

    def test_acclaimed_first_then_balanced_cities(self):
        rows=[{**SEED,"id":str(i),"name":f"Place {i}","address":f"{i} Main Street","market":"New York" if i%2 else "Boston"} for i in range(10)]
        rows[-1].update(guide_tier="starred",guide_stars=2,selection_score=1)
        picked=choose(rows,5)
        self.assertEqual(picked[0]["id"],"9")
        self.assertEqual({r["market"] for r in picked[1:]},{"New York","Boston"})

    def test_duplicate_record_and_chain_cap(self):
        rows=[{**SEED,"id":str(i),"address":f"{i} Main Street","brand":"Chain"} for i in range(10)]
        rows.append({**rows[0],"id":"duplicate"})
        picked=choose(rows,20)
        self.assertEqual(len(picked),3)

    def test_guide_match_requires_coordinates(self):
        refs={"excellent bistro":[{"n":SEED["name"],"la":34.0,"lng":-118.,"s":3}]}
        self.assertIsNone(classify(SEED,refs)["guide_tier"])

    def test_regional_import_does_not_retain_other_markets(self):
        self.assertIsNone(classify(SEED,{},markets=[('Los Angeles',34.052,-118.244,65)]))


class QueueTests(unittest.TestCase):
    def test_reuse_requires_same_branch_version_and_skips_completed(self):
        with tempfile.TemporaryDirectory() as td:
            source_dir=Path(td)/'source'
            source=connect(source_dir/'pilot.sqlite');dest=connect(Path(td)/'dest.sqlite')
            result={'collector_version':COLLECTOR_VERSION,'status':'no_facts','pages':[],'observations':[]}
            for name in ['same','moved','old_version']:
                original={**SEED,'id':name}
                newer={**original,'lat':42} if name=='moved' else original
                saved={**result,'collector_version':'old'} if name=='old_version' else result
                source.execute("INSERT INTO restaurants(id,priority,seed,status,result,updated_at) VALUES(?,?,?,?,?,?)",(name,1,json.dumps(original),'no_facts',json.dumps(saved),'now'))
                dest.execute("INSERT INTO restaurants(id,priority,seed,updated_at) VALUES(?,?,?,?)",(name,1,json.dumps(newer),'now'))
            source.execute("INSERT INTO runs(requests,finished_at) VALUES(7,'now')")
            source.commit();dest.commit();source.close()
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(reuse_results(dest,source_dir),1)
                self.assertEqual(reuse_results(dest,source_dir),0)
            self.assertEqual(dest.execute('SELECT sum(requests) FROM runs').fetchone()[0],7)
            self.assertEqual(dest.execute("SELECT count(*) FROM restaurants WHERE status='pending'").fetchone()[0],2)
            dest.close()

    def test_resume_and_exports(self):
        with tempfile.TemporaryDirectory() as td:
            output=Path(td)
            candidates=output/"candidates.jsonl"
            candidates.write_text(json.dumps(SEED)+"\n")
            db=connect(output/"pilot.sqlite")
            with contextlib.redirect_stdout(io.StringIO()):
                import_selection(db,candidates,1)
            db.execute("INSERT INTO runs(started_at,requests,settings) VALUES('earlier',2,'{}')")
            db.execute("UPDATE restaurants SET status='running',attempts=1")
            db.commit()
            args=argparse.Namespace(contact="https://example.org/bot",delay=1,timeout=2,max_requests=10,workers=1,max_pages=1,retry_errors=False,limit=1)
            result={"status":"facts_found","observations":[{"field":"hours","branch_status":"matched","value":"Mo 17:00-23:00"}],"pages":[]}
            with patch("pilot.collect",return_value=result) as collect_mock, contextlib.redirect_stdout(io.StringIO()):
                crawl(db,args);crawl(db,args);export(db,output)
                self.assertEqual(collect_mock.call_count,1)
            summary=json.loads((output/"summary.json").read_text())
            self.assertEqual(summary["restaurants_with_branch_matched_website_facts"],1)
            self.assertEqual(summary["paid_api_requests"],0)
            self.assertEqual(summary['interrupted_runs_recovered'],1)
            self.assertEqual(db.execute('SELECT count(*) FROM runs WHERE finished_at IS NULL').fetchone()[0],0)
            with self.assertRaises(SystemExit): import_selection(db,candidates,1)
            db.close()

    def test_budget_exhaustion_stays_pending(self):
        with tempfile.TemporaryDirectory() as td:
            db=connect(Path(td)/"pilot.sqlite")
            with db: db.execute("INSERT INTO restaurants(id,priority,seed,updated_at) VALUES(?,?,?,?)",("one",1,json.dumps(SEED),"now"))
            args=argparse.Namespace(contact="https://example.org/bot",delay=1,timeout=2,max_requests=1,workers=1,max_pages=1,retry_errors=False,limit=1)
            result={"status":"fetch_error","observations":[],"pages":[{"error":"request_budget_exhausted"}]}
            with patch("pilot.collect",return_value=result),contextlib.redirect_stdout(io.StringIO()): crawl(db,args)
            row=db.execute("SELECT status,attempts FROM restaurants").fetchone()
            self.assertEqual(tuple(row),("pending",0))
            db.close()

    def test_csv_formula_cells_escaped(self):
        self.assertTrue(safe_cell("=IMPORTXML('x')").startswith("'"))
        self.assertEqual(safe_cell("Excellent Bistro"),"Excellent Bistro")

    def test_insufficient_candidates_do_not_create_partial_cohort(self):
        with tempfile.TemporaryDirectory() as td:
            db=connect(Path(td)/"pilot.sqlite")
            source=Path(td)/"candidates.jsonl"
            source.write_text(json.dumps(SEED)+"\n")
            with self.assertRaises(SystemExit): import_selection(db,source,2)
            self.assertEqual(db.execute("SELECT count(*) FROM restaurants").fetchone()[0],0)
            db.close()


if __name__ == "__main__":
    unittest.main()
