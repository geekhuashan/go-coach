import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../static/growth.js', import.meta.url), 'utf8');
class Node {
  constructor(tag = 'div') {this.tagName = tag;this.children = [];this.dataset = {};this.hidden = false;this.className = '';this.textContent = '';this.isConnected = true;this.attributes = {};this.style = {setProperty(){}};}
  get classList() {return {remove:(...names) => {this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' ');},add:name => {this.className += ' ' + name;}};}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this.children = nodes;}
  setAttribute(name, value) {this.attributes[name] = value;}
  removeAttribute(name) {delete this.attributes[name];if (name === 'data-feedback') delete this.dataset.feedback;}
  addEventListener() {}
}
function client({reduced = false} = {}) {
  const elements = new Map(['growth-completion','growth-collection','inline-assessment'].map(id => [id, new Node()]));
  elements.get('growth-completion').hidden = true;
  const context = vm.createContext({window:{matchMedia:() => ({matches:reduced})},document:{createElement:tag => new Node(tag),getElementById:id => elements.get(id)}});
  vm.runInContext(source, context);return {api:context.window.GoGrowth,elements};
}
const badge = (id = 'first', profile = 'child') => ({id,kind:'first_solve',title:'第一手小发现',date:'2026-10-15',reason:'已保存的一种独立棋形。',profile_id:profile});
const attempt = (extra = {}) => ({profile_id:'child',lesson_id:'one',attempt_no:1,created_at:'2026-10-15T10:00:00Z',correct:true,...extra});
const state = (extra = {}) => ({profile:{id:'child'},mode:'lesson',lesson:{id:'one'},lesson_attempted:false,recent_attempts:[],growth:{method:'family-go-growth-v1',scope:'profile',badges:[]},...extra});
const solved = (extra = {}) => state({lesson_attempted:true,assessment:{correct:true},recent_attempts:[attempt()],...extra});
const moving = host => host.children[0]?.className.includes('is-moving');
test('only a successful saved full attempt counts as completion, not moves, AI opinion, history or navigation', () => {
  const {api} = client(), previous = state();
  assert.ok(api.completedAttempt(previous, solved(), 'play'));
  assert.ok(api.completedAttempt(previous, solved({lesson_progress:{status:'solved'}}), 'submit_answer'));
  for (const next of [solved({lesson_attempted:false}),solved({lesson_progress:{status:'playing'}}),solved({lesson_playout:true}),solved({demo_active:true}),solved({recent_attempts:[]}),solved({recent_attempts:[attempt({correct:false})]}),solved({profile:{id:'parent'}}),solved({lesson:{id:'other'}}),solved({mode:'free'})]) assert.equal(api.completedAttempt(previous, next, 'play'), null);
  for (const type of [null,'next_lesson','retry','ai_move','resume_match','solution','inspect','switch_profile']) assert.equal(api.completedAttempt(previous, solved(), type), null);
  assert.equal(api.completedAttempt(solved(), solved(), 'play'), null);
  assert.equal(api.completedAttempt(state({recent_attempts:[attempt()]}), solved(), 'play'), null);
});
test('initial history is quiet; a genuinely new badge strengthens only the completion action', () => {
  const {api,elements} = client(), host = elements.get('growth-completion'), first = state();
  api.observe(first);assert.equal(host.hidden, true);
  const next = solved({growth:{method:'family-go-growth-v1',scope:'profile',badges:[badge()]}});
  api.observe(next,{previous:first,actionType:'play'});assert.equal(host.hidden,false);assert.equal(moving(host),true);assert.match(host.children[0].className,/has-badge/);
  const scene = host.children[0];api.observe(next,{previous:next,actionType:'play'});assert.equal(host.children[0],scene);
  api.clear();api.observe(next);assert.equal(host.hidden,true);
});
test('passive reads and profile switches consume new IDs without queuing a false reward', () => {
  const {api,elements} = client(), first = state(), awarded = state({growth:{method:'family-go-growth-v1',scope:'profile',badges:[badge()]}});
  api.observe(first);api.observe(awarded,{previous:first});
  api.observe(solved({growth:awarded.growth}),{previous:awarded,actionType:'play'});
  assert.doesNotMatch(elements.get('growth-completion').children[0].className,/has-badge/);
  const other = state({profile:{id:'parent'},growth:{method:'family-go-growth-v1',scope:'profile',badges:[badge('parent-first','parent')]}});
  api.observe(other,{previous:awarded,actionType:'switch_profile'});assert.equal(elements.get('growth-completion').hidden,true);
  api.observe(awarded,{previous:other,actionType:'switch_profile'});assert.equal(elements.get('growth-completion').hidden,true);
});
test('retry completion can encourage without reissuing an existing badge; reduced motion stays static', () => {
  const {api,elements} = client({reduced:true}), first = state({growth:{method:'family-go-growth-v1',scope:'profile',badges:[badge()]}});
  api.observe(first);api.observe(solved({recent_attempts:[attempt({attempt_no:2})],growth:first.growth}),{previous:first,actionType:'play'});
  const host = elements.get('growth-completion');assert.equal(host.hidden,false);assert.equal(moving(host),false);assert.doesNotMatch(host.children[0].className,/has-badge/);
});
test('wrong saved answers get brief feedback, while unknown or engine-only reviews do not', () => {
  const {api,elements} = client(), first = state();api.observe(first);
  const wrong = solved({assessment:{correct:false,review:{source:'author'}},recent_attempts:[attempt({correct:false})]});
  api.observe(wrong,{previous:first,actionType:'play'});assert.equal(elements.get('inline-assessment').dataset.feedback,'retry');assert.equal(elements.get('growth-completion').hidden,true);
  api.observe(first,{previous:wrong,actionType:'retry'});assert.equal(elements.get('inline-assessment').dataset.feedback,undefined);
  api.observe({...wrong,assessment:{correct:false,review:{source:'katago'}}},{previous:first,actionType:'review_move'});assert.equal(elements.get('inline-assessment').dataset.feedback,undefined);
});
test('badge collection validates source and profile, deduplicates IDs and preserves open cards on unchanged state', () => {
  const {api,elements} = client();const s = state({growth:{method:'family-go-growth-v1',scope:'profile',badges:[badge(),badge(),badge('other','parent'),{...badge('bad'),date:'unknown'}]}});
  assert.equal(api.badgesFor(s).length,1);assert.equal(api.badgesFor({...s,growth:{method:'wrong',scope:'profile',badges:[badge()]}}).length,0);
  assert.equal(api.badgesFor({...s,growth:{method:'family-go-growth-v1',scope:'profile',badges:{}}}).length,0);
  api.renderCollection(s);const host = elements.get('growth-collection'), card = host.children.at(-1).children[0];card.open = true;
  api.renderCollection(structuredClone(s));assert.equal(host.children.at(-1).children[0],card);assert.equal(card.open,true);
  api.clear();assert.equal(host.children.length,0);
});
