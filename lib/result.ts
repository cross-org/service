/**
 * Represents the result of a service installation operation.
 *
 * @interface ServiceInstallResult
 */
export interface ServiceInstallResult {
  /**
   * The absolute path to the installed service configuration file, if applicable.
   * Might be null if installation doesn't involve writing a configuration file.
   */
  servicePath: string | null;

  /**
   * The generated content of the service configuration file.  This can be
   * useful for providing instructions to the user for manual configuration
   * if necessary.
   */
  serviceFileContent: string;

  /**
   * A list of additional manual steps the user might need to take to
   * complete the installation process. This would be used in cases where
   * the installation process cannot be fully automated.
   */
  manualSteps: ServiceManualStep[] | null;
}

/**
 * Represents the result of service uninstallation operation.
 *
 * @interface ServiceUninstallResult
 */
export interface ServiceUninstallResult {
  /**
   * The absolute path to the service configuration file that was removed
   * (if applicable). Might be null in some cases.
   */
  servicePath: string | null;

  /**
   * A list of additional manual steps the user might need to take to
   * complete the uninstallation process, if the process cannot be
   * fully automated.
   */
  manualSteps: ServiceManualStep[] | null;
}

/**
 * Represents a single manual step the user might need to perform
 * as part of service installation or uninstallation.
 *
 * @interface ServiceManualStep
 */
export interface ServiceManualStep {
  /**
   * A textual description of the step the user needs to perform.
   */
  text: string;

  /**
   * A command the user might need to execute (e.g., in a system terminal).
   * This is optional.
   */
  command?: string;
}
