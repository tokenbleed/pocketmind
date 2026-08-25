/**
 * Firebase App Check stub.
 *
 * The RNFirebase SDK and the google-services plugin were removed from
 * this build: the benchmark/feedback cloud submission endpoints they
 * guarded are not deployed, and linking the Firebase SDK meant its
 * installation/telemetry traffic ran regardless. Both call sites
 * (api/benchmark.ts, api/feedback.ts) treat a null App Check token as
 * a fail-closed rejection, which this stub preserves without any
 * Firebase native code in the app.
 */
export const initializeAppCheck = async (): Promise<void> => {};

export const getAppCheckToken = async (): Promise<string | null> => null;
