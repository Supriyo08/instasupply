import { httpsCallable, type Functions } from 'firebase/functions';

/**
 * Typed callable invoker. `Map` maps each callable name to its [request, response] pair, so a
 * contract change in @instasupply/shared is a compile error in the app.
 */
export function createCaller<Map extends Record<string, [unknown, unknown]>>(
  functions: Functions,
  names: { [Name in keyof Map]: string },
) {
  return async function call<Name extends keyof Map>(name: Name, data: Map[Name][0]): Promise<Map[Name][1]> {
    const callable = httpsCallable<Map[Name][0], Map[Name][1]>(functions, names[name]);
    const result = await callable(data);
    return result.data;
  };
}
