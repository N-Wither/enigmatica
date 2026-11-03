import enUS from '../lang/en-us.json' with { type: 'json' }
import zhCN from '../lang/zh-cn.json' with { type: 'json' }
// Add more languages here
import { Localizer, type LanguageMap } from '../core/localize'

const languages: LanguageMap = {
  'en-us': enUS,
  'zh-cn': zhCN,
}

const keyPrefix = 'translate:'

const localizer = new Localizer(languages)

/** Directly convert a translate key to localized string. Designed for fixed content. */
export function localize(string: string, ...replacements: unknown[]) {
  return localizer.translate(string, ...replacements)
}

/** Translate a string starts with `translate:` prefix. */
export function translate(string: string, ...replacements: unknown[]) {
  if (string.startsWith(keyPrefix) == false) {
    return string
  } else {
    return localizer.translate(string.replace(keyPrefix, ''), ...replacements)
  }
}
