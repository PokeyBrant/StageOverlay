export type DropdownOption = {
  value: string
  label: string
}

type SelectCandidate = {
  options: DropdownOption[]
}

const divisionHints = [
  'overall',
  'carry optics',
  'limited optics',
  'limited',
  'open',
  'production',
  'single stack',
  'revolver',
  'pcc',
  'limited 10',
  'optics',
  'iron'
]

function normalizeOptionLabel(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function isNumericLabel(value: string) {
  return /^\d+$/.test(value)
}

function isDivisionLikeLabel(value: string) {
  return divisionHints.some((hint) => value.includes(hint))
}

function isScopeLikeLabel(value: string) {
  return /\bstage\b/.test(value) || value.includes('match') || value.includes('overall')
}

function scoreDivisionControl(options: DropdownOption[]) {
  const labels = options.map((option) => normalizeOptionLabel(option.label)).filter(Boolean)
  if (labels.length < 2 || labels.every(isNumericLabel)) {
    return Number.NEGATIVE_INFINITY
  }

  let score = 0
  const overallCount = labels.filter((label) => label === 'overall').length
  const divisionCount = labels.filter(isDivisionLikeLabel).length
  const stageCount = labels.filter((label) => /\bstage\b/.test(label)).length

  score += overallCount * 5
  score += divisionCount * 2
  score -= stageCount * 3

  return score
}

function scoreScopeControl(options: DropdownOption[]) {
  const labels = options.map((option) => normalizeOptionLabel(option.label)).filter(Boolean)
  if (labels.length < 2 || labels.every(isNumericLabel)) {
    return Number.NEGATIVE_INFINITY
  }

  let score = 0
  const stageCount = labels.filter((label) => /\bstage\b/.test(label)).length
  const overallOrMatchCount = labels.filter((label) => label === 'overall' || label.includes('match')).length
  const divisionCount = labels.filter(isDivisionLikeLabel).length

  score += stageCount * 4
  score += overallOrMatchCount * 2
  score -= divisionCount * 2

  return score
}

export function pickResultsControlIndexes(selects: SelectCandidate[]) {
  let bestDivisionIndex = -1
  let bestDivisionScore = Number.NEGATIVE_INFINITY

  for (let index = 0; index < selects.length; index += 1) {
    const score = scoreDivisionControl(selects[index]!.options)
    if (score > bestDivisionScore) {
      bestDivisionScore = score
      bestDivisionIndex = index
    }
  }

  if (bestDivisionIndex === -1 || bestDivisionScore <= 0) {
    return null
  }

  let bestScopeIndex = -1
  let bestScopeScore = Number.NEGATIVE_INFINITY

  for (let index = 0; index < selects.length; index += 1) {
    if (index === bestDivisionIndex) continue

    const score = scoreScopeControl(selects[index]!.options)
    if (score > bestScopeScore) {
      bestScopeScore = score
      bestScopeIndex = index
    }
  }

  if (bestScopeIndex === -1 || bestScopeScore <= 0) {
    return null
  }

  return {
    scopeIndex: bestScopeIndex,
    divisionIndex: bestDivisionIndex
  }
}

