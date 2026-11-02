export namespace AssetManager {
  /**
   * @example ```
   * AssetManager.urlFromPath('image/example.png') // `{YOUR HOST}/assets/image/example.png`
   * ```
   * Specially, if path is an empty string, this function will also return empty string to avoid unexpected web request.
   */
  export function urlFromPath(path: string) {
    return path != '' ? `${location.origin}/assets/${path}` : ''
  }
}
