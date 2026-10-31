export type LanguageMap = Record<string, Record<string, string>>

export class Localizer {
  defaultLang = 'en-us'
  map: LanguageMap

  constructor(map: LanguageMap) {
    this.map = map
  }

  /** Translate a key. This method will read document's `lang` property and find corresponding translation.*/
  translate(key: string, ...replacements: unknown[]) {
    const currentLang = document.documentElement.lang.toLowerCase() ?? this.defaultLang
    const targetLang = Object.keys(this.map).find((name) => name.startsWith(currentLang)) ?? this.defaultLang
    const currentMap = this.map[targetLang]
    if (key in currentMap) {
      if (replacements.length == 0) {
        return currentMap[key]
      } else {
        let result = currentMap[key]
        // TODO support custom replacement order like `%1s` `%2s`
        replacements.forEach((replacement) => {
          result = result.replace('%s', String(replacement))
        })
        return result
      }
    } else {
      return key
    }
  }
}
