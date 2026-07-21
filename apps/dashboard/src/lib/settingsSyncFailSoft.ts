export type SettingsPersist<T> = (settings: T) => Promise<unknown>;

export function createFailSoftSettingsSaver<T>(
  persist: SettingsPersist<T>,
  onFirstFailure: (error: unknown) => void
) {
  let failureReported = false;

  return async (settings: T): Promise<boolean> => {
    try {
      await persist(settings);
      return true;
    } catch (error) {
      if (!failureReported) {
        failureReported = true;
        onFirstFailure(error);
      }
      return false;
    }
  };
}
