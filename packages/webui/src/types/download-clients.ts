// Definition of the DownloadClient type
export type TDownloadClient = {
  name?: string;
  index?: number;
  client: string;
  url: string;
  user?: string;
  password: string;
  readOnly?: boolean;
};
