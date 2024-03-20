export interface ServiceInstallResult {
  servicePath: string | null;
  serviceFileContent: string;
  manualSteps: string | null;
}

export interface ServiceUninstallResult {
  servicePath: string | null;
  manualSteps: string | null;
}
