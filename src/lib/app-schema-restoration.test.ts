import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const migration=readFileSync(new URL('../../supabase/migrations/20260911183229_audit_restore_optional_app_columns.sql',import.meta.url),'utf8');
it('restores missing columns from valid mirrors without altering data on a rerun',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create table user_app_data(user_id text primary key,restaurant_meta jsonb);
   insert into user_app_data values ('one','{"__trips__":[{"id":"trip"}],"__home_meals__":[{"id":"meal"}],"unrelated":true}'),('two','{"__trips__":null,"__home_meals__":"invalid"}');`);
  await db.exec(migration);
  const rows=await db.query<any>('select * from user_app_data order by user_id');
  expect(rows.rows[0]).toMatchObject({trips:[{id:'trip'}],home_meals:[{id:'meal'}],restaurant_meta:{unrelated:true}});
  expect(rows.rows[1]).toMatchObject({trips:[],home_meals:[]});
  await db.exec("update user_app_data set trips='[]',home_meals='[]' where user_id='one'");
  await db.exec(migration);
  expect((await db.query<any>("select trips,home_meals from user_app_data where user_id='one'")).rows[0]).toEqual({trips:[],home_meals:[]});
 }finally{await db.close();}
});
