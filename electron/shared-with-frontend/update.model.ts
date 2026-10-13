export interface UpdateDiscovery {
  tag?: string;
  canDownload: boolean;
}

export interface UpdateDownloadStatus {
  state: 'idle' | 'downloading' | 'verifying' | 'ready' | 'error';
  tag?: string;
  percent?: number;
}
