/**
 * Thin wrapper around Plate Recognizer's Snapshot API.
 * https://docs.platerecognizer.com/
 *
 * Kept as a standalone module so the ANPR provider can be swapped
 * (e.g. to an on-prem SimpleLPR binary) without touching the rest
 * of the ingestion pipeline.
 */

export interface AnprResult {
  plateNumber: string | null;
  confidence: number | null;
  vehicleColor: string | null;
  vehicleMakeModel: string | null;
  raw: unknown;
}

export async function recognizePlate(imageBuffer: Buffer): Promise<AnprResult> {
  const apiKey = process.env.PLATE_RECOGNIZER_API_KEY;
  if (!apiKey) throw new Error("PLATE_RECOGNIZER_API_KEY is not set");

  const form = new FormData();
  form.append("upload", new Blob([imageBuffer]), "snapshot.jpg");
  // mmc=1 requests vehicle make/model/color (billed at +50% per Plate Recognizer pricing)
  form.append("mmc", "1");

  const res = await fetch("https://api.platerecognizer.com/v1/plate-reader/", {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Plate Recognizer request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const result = data.results?.[0];

  if (!result) {
    return { plateNumber: null, confidence: null, vehicleColor: null, vehicleMakeModel: null, raw: data };
  }

  return {
    plateNumber: result.plate ?? null,
    confidence: result.score ?? null,
    vehicleColor: result.vehicle?.color?.[0]?.name ?? null,
    vehicleMakeModel: result.model_make ?? null,
    raw: data,
  };
}
