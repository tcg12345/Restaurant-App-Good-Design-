"""Check TLS trust and Python compatibility before consuming a crawl queue."""
import json
import ssl
import sys

from collector import RobotsPolicy, public_addresses, pinned_connection, now


def check_runtime():
    result={'checked_at':now(),'python':sys.executable,'python_version':sys.version.split()[0],'ok':False}
    try:
        policy=RobotsPolicy()
        policy.parse(['User-agent: *','Crawl-delay: 2','Request-rate: 1/2','Disallow: /private'])
        if policy.crawl_delay('GoodEatsResearchBot') != 2 or policy.request_rate('GoodEatsResearchBot').seconds != 2:
            raise RuntimeError('Robots policy compatibility check failed')
        if policy.can_fetch('GoodEatsResearchBot','https://example.com/private'):
            raise RuntimeError('Robots policy restriction check failed')
        context=ssl.create_default_context()
        result['trusted_ca_count']=len(context.get_ca_certs())
        if not result['trusted_ca_count']:
            raise ssl.SSLCertVerificationError('Python has no trusted root certificates. Run its Install Certificates.command.')
        result['tls_hosts']=[]
        # TLS handshakes only: no page downloads, paid APIs or restaurant requests.
        for host in ('www.python.org','pypi.org'):
            with pinned_connection(public_addresses(host,443),12) as connection:
                with context.wrap_socket(connection,server_hostname=host):
                    result['tls_hosts'].append(host)
        result['ok']=True
    except Exception as error:
        result['error']=f'{type(error).__name__}: {error}'[:500]
    return result


if __name__=='__main__':
    result=check_runtime();print(json.dumps(result,indent=2));sys.exit(0 if result['ok'] else 1)
