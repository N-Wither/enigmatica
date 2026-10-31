export namespace AssetManager {
  /**
   * @example ```
   * Asset.urlFromPath('image/example.png') // `{YOUR HOST}/image/example.png`
   * ```
   * Specially, if path is an empty string, this function will also return empty string to avoid unexpected web request.
   */
  export function urlFromPath(path: string) {
    return path != '' ? `${location.origin}/${path}` : ''
  }
}
