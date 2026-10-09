import { getLivePopups } from "@/lib/popups";
import { PopupHost } from "./popup-host";

/** The store's pop-ups, if any are switched on. Mounted once, for every page. */
export async function Popups() {
  const popups = await getLivePopups();
  return popups.length > 0 ? <PopupHost popups={popups} /> : null;
}
