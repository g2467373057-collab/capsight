/** Robots.txt rules for one user-agent: longest matching rule wins, Allow beats Disallow on ties. */
export interface RobotsRules {
  rules: { allow: boolean; path: string }[]
}

export function parseRobots(txt: string, agent: string): RobotsRules {
  const want = agent.toLowerCase()
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = []
  let cur: (typeof groups)[number] | null = null
  let lastWasAgent = false
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const val = line.slice(i + 1).trim()
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] }
        groups.push(cur)
      }
      cur.agents.push(val.toLowerCase())
      lastWasAgent = true
    } else {
      lastWasAgent = false
      if (!cur) continue
      if (key === 'disallow' && val) cur.rules.push({ allow: false, path: val })
      else if (key === 'allow' && val) cur.rules.push({ allow: true, path: val })
    }
  }
  const token = want.split(/[\s/]/)[0]
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)))
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'))
  return { rules: chosen.flatMap((g) => g.rules) }
}

function ruleMatches(rulePath: string, path: string): number {
  // supports * wildcards and $ end anchor; returns match length or -1
  const anchored = rulePath.endsWith('$')
  const pattern = (anchored ? rulePath.slice(0, -1) : rulePath).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  const re = new RegExp('^' + pattern + (anchored ? '$' : ''))
  return re.test(path) ? rulePath.length : -1
}

export function isAllowed(r: RobotsRules, pathAndQuery: string): boolean {
  let best = -1
  let allow = true
  for (const rule of r.rules) {
    const len = ruleMatches(rule.path, pathAndQuery)
    if (len > best || (len === best && rule.allow)) {
      if (len >= 0) {
        best = len
        allow = rule.allow
      }
    }
  }
  return allow
}
