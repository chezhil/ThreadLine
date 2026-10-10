"use client";

import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Button } from "@/components/quality/ui/Button";
import { Input } from "@/components/quality/ui/Input";
import { Camera, X, Scan, Keyboard } from "lucide-react";

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (token: string) => void;
  title?: string;
}

export function QrScannerModal({
  isOpen,
  onClose,
  onScan,
  title = "Scan Roll QR Code",
}: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [manualInput, setManualInput] = useState("");
  const [mode, setMode] = useState<"camera" | "manual">("camera");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const animFrameId = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      setCameraError(null);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        await videoRef.current.play();
        requestAnimationFrame(tick);
      }
    } catch (err: any) {
      console.warn("Camera access failed:", err);
      setCameraError("Camera unavailable or permission denied. Use manual input.");
      setMode("manual");
    }
  };

  const stopCamera = () => {
    if (animFrameId.current) {
      cancelAnimationFrame(animFrameId.current);
      animFrameId.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const tick = () => {
    if (!videoRef.current || !canvasRef.current) return;

    if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        canvas.height = videoRef.current.videoHeight;
        canvas.width = videoRef.current.videoWidth;
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
          // Detected QR Code!
          // Extract token from full URL or use raw token string
          let token = code.data;
          try {
            if (token.includes("token=")) {
              const url = new URL(token);
              token = url.searchParams.get("token") || token;
            } else if (token.includes("/rolls/")) {
              const parts = token.split("/");
              token = parts[parts.length - 1];
            }
          } catch {
            // keep raw token
          }

          stopCamera();
          onScan(token);
          onClose();
          return;
        }
      }
    }

    animFrameId.current = requestAnimationFrame(tick);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    onScan(manualInput.trim());
    setManualInput("");
    onClose();
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    if (mode === "camera") {
      // startCamera only sets state after awaiting the camera, never synchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, mode]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scan className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-slate-900 text-base">{title}</h3>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="p-2 bg-slate-50 flex border-b border-slate-100">
          <button
            onClick={() => setMode("camera")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
              mode === "camera"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Camera className="w-4 h-4" />
            Live Camera
          </button>
          <button
            onClick={() => setMode("manual")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
              mode === "manual"
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Keyboard className="w-4 h-4" />
            Manual / Gun Scan
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1">
          {mode === "camera" ? (
            <div className="relative aspect-square bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                muted
                playsInline
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Viewfinder Target Frame */}
              <div className="absolute inset-10 border-2 border-indigo-400/80 rounded-xl pointer-events-none flex items-center justify-center">
                <div className="w-full h-0.5 bg-indigo-500/80 animate-pulse" />
              </div>

              {cameraError && (
                <div className="absolute inset-0 bg-slate-950/80 p-4 flex flex-col items-center justify-center text-center text-white text-xs">
                  <p className="text-rose-400 font-semibold mb-2">{cameraError}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setMode("manual")}
                  >
                    Switch to Manual
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleManualSubmit} className="space-y-4 py-4">
              <p className="text-xs text-slate-500">
                Type or scan QR token using a USB/Bluetooth barcode scanner, or paste roll number / token:
              </p>
              <Input
                label="Roll QR Token or Roll No"
                placeholder="e.g. TL-ROLL-XXXXX or ROL-2610-0001"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                autoFocus
              />
              <Button type="submit" className="w-full" variant="primary">
                Confirm & Lookup Roll
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
