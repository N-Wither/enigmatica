export namespace ObjectUtils {
  export function isObject(o: any) {
    return typeof o == 'object' && o !== null
  }

  export function isEmpty(o: any) {
    return isObject(o) ? Reflect.ownKeys(o).length == 0 : true
  }

  /** 
   * Compare two objects recursively, symbol-named properties will be ignored.
   * @returns `true` if they have same property and values, `false` if not.
   */
  export function same(obj1: any, obj2: any): boolean {
    if (Object.is(obj1, obj2)) return true
    if ((isObject(obj1) && isObject(obj2)) == false) return obj1 === obj2

    const entriesA = Object.entries(obj1)
    const entriesB = Object.entries(obj2)

    if (entriesA.length != entriesB.length) return false

    return entriesA.every(([k, v]) => same(v, obj2[k]))
  }

  /**
   * Check if all properties of `obj2` exsit in `obj1` and the values are the same recursively.
   */
  export function partialSame(obj1: any, obj2: any): boolean {
    if (Object.is(obj1, obj2)) return true
    if ((isObject(obj1) && isObject(obj2)) == false) return obj1 === obj2

    const entriesB = Object.entries(obj2)

    return entriesB.every(([k, v]) => partialSame(v, obj1[k]))
  }
}
