import twilio from "twilio";

export interface CintelSummary {
  sentiment?: string;
  summary?: string;
}

export interface CallTrackerItem {
  status: "calling" | "in-progress" | "completed" | "failed";
  tasks: { coffee_order_placed: boolean; coffee_question_asked: boolean; world_tour_guessed: boolean };
  history: { role: "user" | "ai"; text: string }[];
  duration?: number;
  viSid?: string;
  cintel?: CintelSummary;
  observations?: string[];
  summaries?: string[];
}

export const SYNC_MAP_NAME = "callTracker";
export const SYNC_ITEM_TTL = 604800;

function getTwilio() {
  return twilio(process.env.TWILIO_API_KEY!, process.env.TWILIO_API_SECRET!, { accountSid: process.env.TWILIO_ACCOUNT_SID! });
}

export function getSyncItem(callSid: string) {
  return getTwilio().sync.v1
    .services(process.env.TWILIO_SYNC_SERVICE_SID!)
    .syncMaps(SYNC_MAP_NAME)
    .syncMapItems(callSid);
}

export async function updateCallTracker(callSid: string, patch: Partial<CallTrackerItem>, attempt = 0): Promise<void> {
  try {
    const item = await getSyncItem(callSid).fetch();
    const current = item.data as CallTrackerItem;
    await getSyncItem(callSid).update({
      data: { ...current, ...patch },
      ttl: SYNC_ITEM_TTL,
    });
  } catch (err: any) {
    // Sync item not yet created — race between callStatus webhook and Sync write.
    if (err?.status === 404 && attempt < 5) {
      await new Promise(r => setTimeout(r, 200 * 2 ** attempt));
      return updateCallTracker(callSid, patch, attempt + 1);
    }
    console.error(`[sync] updateCallTracker error (${callSid}):`, err);
  }
}
