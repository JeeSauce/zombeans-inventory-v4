"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, ScanBarcode, Search, Square } from "lucide-react";
import { lookupBarcodeAction } from "@/app/(app)/offline-pos/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BarcodeLookupResult } from "@/lib/validation/phase10";

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export function BarcodeLookup() {
  const [barcode, setBarcode] = useState("");
  const [result, setResult] = useState<BarcodeLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pending, startTransition] = useTransition();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  const canUseCamera =
    typeof window !== "undefined" &&
    "BarcodeDetector" in window &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  function stopCamera() {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    frameRef.current = null;
    setScanning(false);
  }

  useEffect(() => stopCamera, []);

  function lookup(value: string) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const response = await lookupBarcodeAction({ barcode: value });
      if (response.error) setError(response.error);
      else if (response.result) setResult(response.result);
    });
  }

  async function startCamera() {
    setError(null);
    if (!canUseCamera) {
      setError("Camera barcode detection is unavailable. Use the labelled manual field instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorConstructor })
        .BarcodeDetector;
      const detector = new Detector();
      const scan = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const detections = await detector.detect(videoRef.current);
          const value = detections[0]?.rawValue?.trim();
          if (value) {
            setBarcode(value);
            stopCamera();
            lookup(value);
            return;
          }
        } catch {
          setError("The camera could not decode that barcode. Try manual entry.");
          stopCamera();
          return;
        }
        frameRef.current = requestAnimationFrame(scan);
      };
      frameRef.current = requestAnimationFrame(scan);
    } catch {
      setError("Camera access was not granted. Use manual barcode entry.");
      stopCamera();
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ScanBarcode className="size-5 text-green-600" />
          <CardTitle>Barcode lookup</CardTitle>
        </div>
        <CardDescription>
          Identify an item by barcode. This read-only tool has no quantity or posting control.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            lookup(barcode.trim());
          }}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="barcode-manual">Barcode</Label>
            <Input
              id="barcode-manual"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="Scan or type 480…"
              minLength={3}
              maxLength={128}
              autoComplete="off"
              required
            />
          </div>
          <Button type="submit" disabled={pending || barcode.trim().length < 3}>
            <Search className="size-4" />
            {pending ? "Looking up…" : "Look up"}
          </Button>
          {canUseCamera && (
            <Button type="button" variant="outline" onClick={scanning ? stopCamera : startCamera}>
              {scanning ? <Square className="size-4" /> : <Camera className="size-4" />}
              {scanning ? "Stop camera" : "Use camera"}
            </Button>
          )}
        </form>

        <video
          ref={videoRef}
          className={scanning ? "max-h-64 w-full rounded-lg bg-black object-cover" : "hidden"}
          playsInline
          muted
          aria-label="Barcode camera preview"
        />

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Lookup unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {result?.found === false && (
          <Alert>
            <AlertTitle>No catalog match</AlertTitle>
            <AlertDescription>
              No active item uses barcode {result.barcode}. Check the code or update the catalog.
            </AlertDescription>
          </Alert>
        )}
        {result?.found && (
          <div className="rounded-lg border p-4" aria-live="polite">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{result.name}</p>
                <p className="text-muted-foreground text-sm">
                  {result.sku} · {result.unitCode}
                </p>
              </div>
              <Badge variant="secondary">{result.sourceLabel}</Badge>
            </div>
            <p className="font-data mt-3 text-sm">Barcode: {result.barcode}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
