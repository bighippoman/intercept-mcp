export function archiveDate(timestamp: string | undefined): string | undefined {
  if (!timestamp || !/^\d{14}$/.test(timestamp)) return undefined;
  const date=`${timestamp.slice(0,4)}-${timestamp.slice(4,6)}-${timestamp.slice(6,8)}T${timestamp.slice(8,10)}:${timestamp.slice(10,12)}:${timestamp.slice(12,14)}Z`;
  return Number.isFinite(Date.parse(date)) ? date : undefined;
}
