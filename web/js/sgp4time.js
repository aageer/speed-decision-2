/** UTC milliseconds for an ISO time with microseconds (Date.parse keeps only milliseconds). */
export function parseUtc(iso) {
  const [date, time = "00:00:00"] = iso.replace("Z", "").split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":");
  return Date.UTC(y, m - 1, d, Number(hh), Number(mm), 0) + Number(ss) * 1000;
}
