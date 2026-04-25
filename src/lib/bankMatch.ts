const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Expands common Nigerian bank abbreviations to a phrase that matches
 * the full bank name returned by Paystack.
 */
const ABBREVIATIONS: Record<string, string> = {
  uba:         'united bank for africa',
  gtb:         'guaranty trust',
  gtbank:      'guaranty trust',
  gt:          'guaranty trust',
  fcmb:        'first city monument',
  fbn:         'first bank',
  firstbank:   'first bank',
  lapo:        'lapo',
  vfd:         'vfd microfinance',
  jaiz:        'jaiz',
  taj:         'taj bank',
  lotus:       'lotus bank',
  moniepoint:  'moniepoint',
  palmpay:     'palmpay',
  stanbic:     'stanbic ibtc',
  ecobank:     'ecobank',
  eco:         'ecobank',
  polaris:     'polaris bank',
  sterling:    'sterling bank',
  heritage:    'heritage bank',
  keystone:    'keystone bank',
  unity:       'unity bank',
  fidelity:    'fidelity bank',
  coronation:  'coronation',
  providus:    'providus',
  suntrust:    'suntrust',
  titan:       'titan trust',
  wema:        'wema bank',
  alat:        'wema bank',
  kuda:        'kuda',
  opay:        'opay',
}

export function matchBanks(
  query: string,
  banks: { code: string; name: string }[]
): { code: string; name: string }[] {
  const trimmed = query.trim()
  const key = norm(trimmed)
  const expanded = norm(ABBREVIATIONS[key] ?? trimmed)

  return banks.filter((b) => {
    const n = norm(b.name)
    return (
      n.includes(expanded) ||
      expanded.includes(n) ||
      n.includes(key) ||
      key.includes(n)
    )
  })
}
