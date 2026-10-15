/* Local, visual-only rewards. Saved server evidence is the only badge source. */
(() => {
  const baseline = new Map();
  let collectionKey = null, completionKey = null;
  const make = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const attemptKey = attempt => JSON.stringify([attempt.profile_id || '', attempt.lesson_id, attempt.attempt_no, attempt.created_at]);
  function badgesFor(state) {
    if (state?.growth?.method !== 'family-go-growth-v1' || state.growth.scope !== 'profile' || !state.profile?.id) return [];
    const badges = new Map();
    for (const badge of Array.isArray(state.growth.badges) ? state.growth.badges : []) {
      if (typeof badge?.id !== 'string' || !badge.id || typeof badge.title !== 'string' || !badge.title ||
          typeof badge.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(badge.date.slice(0, 10)) ||
          badge.profile_id && badge.profile_id !== state.profile.id) continue;
      badges.set(badge.id, badge);
    }
    return [...badges.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }
  function completedAttempt(previous, next, actionType) {
    if (!['play', 'submit_selection', 'submit_answer', 'review_move'].includes(actionType) || !previous ||
        previous.profile?.id !== next?.profile?.id || !next?.profile?.id || previous.mode !== 'lesson' || next.mode !== 'lesson' ||
        !next.lesson?.id || previous.lesson?.id !== next.lesson.id || previous.lesson_attempted || !next.lesson_attempted ||
        next.demo_active || next.lesson_playout || next.lesson_progress && next.lesson_progress.status !== 'solved') return null;
    const known = new Set((previous.recent_attempts || []).map(attemptKey));
    return (next.recent_attempts || []).find(attempt => attempt.lesson_id === next.lesson.id &&
      (!attempt.profile_id || attempt.profile_id === next.profile.id) && attempt.correct === true &&
      typeof attempt.created_at === 'string' && Number.isInteger(attempt.attempt_no) && !known.has(attemptKey(attempt))) || null;
  }
  function play(scene) {
    if (!scene?.isConnected) return;
    scene.classList.remove('is-moving');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    void scene.offsetWidth;
    scene.classList.add('is-moving');
  }
  function companion(badge = null) {
    const scene = make('div', `go-companion${badge ? ' has-badge' : ''}`);
    const replay = make('button', 'go-companion-replay');
    replay.type = 'button';replay.setAttribute('aria-label', badge ? '重播举章庆祝' : '和围棋小伙伴击掌');
    replay.innerHTML = `<svg viewBox="0 0 220 190" aria-hidden="true" focusable="false">
      <ellipse class="go-companion-shadow" cx="110" cy="170" rx="44" ry="7" fill="#365646" opacity=".12"/>
      <g class="go-companion-actor">
        <path d="M85 142v16q-2 10 12 9h6v-26m14 1v17q0 10 14 8h6v-25" fill="#538c76" stroke="#365646" stroke-width="3"/>
        <path d="M80 105q-17-4-25-20" fill="none" stroke="#78bda0" stroke-width="17" stroke-linecap="round"/><circle cx="52" cy="80" r="10" fill="#ffe0b6" stroke="#365646" stroke-width="2.5"/>
        <g class="go-companion-wave"><path d="M141 103q16-5 23-24" fill="none" stroke="#78bda0" stroke-width="17" stroke-linecap="round"/><path d="M163 77q-8-14-3-16l6 6q-1-17 5-16l2 14q6-13 10-9l-5 15q11-6 13-1l-12 15q-10 8-16-8" fill="#ffe0b6" stroke="#365646" stroke-width="2.5" stroke-linejoin="round"/></g>
        <rect x="77" y="96" width="67" height="53" rx="24" fill="#85c8a9" stroke="#365646" stroke-width="3"/>
        <circle cx="102" cy="124" r="9" fill="#365646"/><circle cx="122" cy="124" r="9" fill="#fffefa" stroke="#a9b4a2" stroke-width="1.5"/>
        <rect x="59" y="27" width="105" height="80" rx="35" fill="#85c8a9" stroke="#365646" stroke-width="3"/>
        <path d="M108 26v-9" stroke="#365646" stroke-width="3" stroke-linecap="round"/><path d="M109 4l4 6 7 1-5 5 1 7-7-3-6 3 1-7-5-5 7-1z" fill="#ffd26f" stroke="#b99544" stroke-width="2"/>
        <rect x="68" y="40" width="87" height="58" rx="26" fill="#ffefd3"/>
        <ellipse cx="91" cy="67" rx="4.5" ry="6" fill="#365646"/><ellipse cx="132" cy="67" rx="4.5" ry="6" fill="#365646"/>
        <circle cx="90" cy="65" r="1.5" fill="white"/><circle cx="131" cy="65" r="1.5" fill="white"/>
        <ellipse cx="81" cy="80" rx="8" ry="4" fill="#efaa9b"/><ellipse cx="142" cy="80" rx="8" ry="4" fill="#efaa9b"/>
        <path d="M102 78q9 13 18 0" fill="#e59683" stroke="#365646" stroke-width="2.5" stroke-linecap="round"/>
        ${badge ? '<g class="go-companion-medal"><path d="M162 77l-5 22 16-7 12 10 3-24" fill="#d8974a" stroke="#8b673b" stroke-width="2"/><circle cx="176" cy="64" r="21" fill="#ffda79" stroke="#b78a3d" stroke-width="3"/><circle cx="176" cy="64" r="15" fill="#fff1b5"/><path d="M176 52l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="#d79531"/></g>' : ''}
      </g></svg><span>再看一次</span>`;
    replay.onclick = () => play(scene);scene.append(replay);
    if (badge) {
      const fireworks = make('div', 'go-growth-fireworks');fireworks.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 16; i++) {const spark = make('i');spark.style.setProperty('--angle', `${i * 22.5}deg`);spark.style.setProperty('--delay', `${i % 4 * 25}ms`);fireworks.append(spark);}
      scene.append(fireworks);
    }
    scene.addEventListener('animationend', event => {if (event.animationName === 'go-companion-wave') scene.classList.remove('is-moving');});
    return scene;
  }
  function badgeCard(badge, fresh = false) {
    const details = make('details', `go-growth-badge${fresh ? ' is-new' : ''}`);details.dataset.badgeId = badge.id;details.dataset.kind = badge.kind || 'shape';
    const summary = make('summary'),mark = make('span', 'go-growth-mark', badge.icon || '🏅');mark.setAttribute('aria-hidden', 'true');
    summary.append(mark, make('strong', '', badge.title));details.append(summary);
    const reason = make('div', 'go-growth-reason');reason.append(make('p', '', badge.reason || badge.description || '来自已保存的独立作答。'));
    const date = make('time', '', `获得于 ${badge.date.slice(0, 10)}`);date.dateTime = badge.date.slice(0, 10);reason.append(date);
    const replay = make('button', 'secondary go-growth-replay', '看看举章庆祝');replay.type = 'button';
    replay.onclick = () => {let scene = reason.querySelector('.go-companion');if (!scene) {scene = companion(badge);reason.append(scene);}play(scene);};
    reason.append(replay);details.append(reason);return details;
  }
  function renderCollection(state) {
    const host = document.getElementById('growth-collection');if (!host || !state?.profile?.id) return;
    const badges = badgesFor(state), summary = state.growth?.summary;
    const key = JSON.stringify([state.profile.id, badges, summary]);if (key === collectionKey) return;collectionKey = key;
    const heading = make('div', 'go-growth-heading');heading.append(make('h3', '', '围棋成长徽章'), make('span', '', `${badges.length} 枚`));
    host.replaceChildren(heading);
    if (Number.isInteger(summary?.independent_shapes) && summary.independent_shapes >= 0) host.append(make('p', 'go-growth-summary', `已经独立看懂 ${summary.independent_shapes} 种棋形`));
    if (!badges.length) {host.append(make('p', 'go-growth-empty', '完整做对一道题，慢慢收集成长的脚印。'));return;}
    const grid = make('div', 'go-growth-grid');badges.slice(0, 4).forEach(badge => grid.append(badgeCard(badge)));host.append(grid);
    if (badges.length > 4) {
      const older = make('details', 'go-growth-older');older.append(make('summary', '', `查看其余 ${badges.length - 4} 枚徽章`));
      const more = make('div', 'go-growth-grid');badges.slice(4).forEach(badge => more.append(badgeCard(badge)));older.append(more);host.append(older);
    }
  }
  function hideCompletion() {
    completionKey = null;const host = document.getElementById('growth-completion');if (host) {host.hidden = true;host.replaceChildren();host.parentElement?.classList.remove('has-growth-completion');}
  }
  function observe(next, {previous = null, actionType = null} = {}) {
    const profile = next?.profile?.id;if (!profile) return;
    const badges = badgesFor(next), known = baseline.get(profile);
    // Passive reads consume the baseline quietly, including profile switches and recovery.
    if (next.growth?.method === 'family-go-growth-v1') baseline.set(profile, new Set(badges.map(badge => badge.id)));
    const changedContext = previous?.profile?.id !== profile || previous?.lesson?.id !== next.lesson?.id || !next.lesson_attempted || next.mode !== 'lesson' || next.demo_active || next.lesson_playout;
    if (changedContext) hideCompletion();
    const feedback = document.getElementById('inline-assessment');
    if (changedContext) feedback?.removeAttribute('data-feedback');
    if (previous?.profile?.id === profile && previous.lesson?.id === next.lesson?.id && !previous.lesson_attempted &&
        next.lesson_attempted && !next.demo_active && ['play', 'submit_selection', 'submit_answer', 'review_move'].includes(actionType)) {
      const seen = new Set((previous.recent_attempts || []).map(attemptKey));
      const saved = (next.recent_attempts || []).find(attempt => attempt.lesson_id === next.lesson.id &&
        (!attempt.profile_id || attempt.profile_id === profile) && !seen.has(attemptKey(attempt)));
      const review = next.assessment?.review?.source;
      if (feedback && saved && saved.correct === next.assessment?.correct && (saved.correct === true || saved.correct === false && (!review || ['rules', 'author'].includes(review)))) {
        feedback.removeAttribute('data-feedback');void feedback.offsetWidth;
        feedback.dataset.feedback = saved.correct ? 'correct' : 'retry';
      }
    }
    const completed = completedAttempt(previous, next, actionType);if (!completed) return;
    const key = `${profile}:${attemptKey(completed)}`;if (key === completionKey) return;completionKey = key;
    const fresh = known ? badges.filter(badge => !known.has(badge.id)) : [];
    const host = document.getElementById('growth-completion');if (!host) return;
    const scene = companion(fresh[0] || null), copy = make('div', 'go-growth-completion-copy');
    copy.append(make('strong', '', fresh.length ? '新的成长徽章！' : '这道题完整做对啦！'), make('p', '', fresh.length ? fresh.map(badge => badge.title).join(' · ') : '每一步都想清楚了，真棒。'));
    if (fresh.length) {const details = make('details', 'go-growth-earned-details');details.append(make('summary', '', '看看获得原因'));fresh.forEach(badge => {details.append(make('p', '', badge.reason || badge.description || '来自已保存的独立作答。'), make('small', '', `获得于 ${badge.date.slice(0, 10)}`));});copy.append(details);}
    host.replaceChildren(scene, copy);host.hidden = false;host.parentElement?.classList.add('has-growth-completion');play(scene);
  }
  function clear() {baseline.clear();collectionKey = null;hideCompletion();document.getElementById('growth-collection')?.replaceChildren();}
  window.GoGrowth = Object.freeze({badgesFor, completedAttempt, observe, renderCollection, clear});
})();
