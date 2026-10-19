import test from 'node:test';
import assert from 'node:assert/strict';
import {scanAssetVersions,readManifest,compareAssetVersions} from './asset-versions.mjs';

test('every ?v= static file matches its recorded version and content',()=>{
 const {assets,errors}=scanAssetVersions();
 assert.deepEqual(errors,[]);
 assert.ok(Object.keys(assets).includes('/app.js'));
 assert.deepEqual(compareAssetVersions(assets,readManifest()),[],'升级 ?v= 后运行 npm run assets:versions');
});

test('a changed file under the same version is rejected',()=>{
 const recorded={'/app.js':{v:'1',sha256:'a'},'/old.js':{v:'1',sha256:'b'}};
 assert.deepEqual(compareAssetVersions({'/app.js':{v:'1',sha256:'c'}},recorded),['/app.js 内容变了但 ?v=1 没有升级','/old.js 已不再引用，需要更新版本记录']);
 assert.deepEqual(compareAssetVersions({'/app.js':{v:'2',sha256:'c'}},recorded).slice(0,1),['/app.js 的版本记录需要更新']);
});
