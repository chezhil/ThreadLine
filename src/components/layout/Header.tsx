"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  subscribeToOfflineQueue,
  replayOfflineQueue,
  getAllQueuedItems,
  QueuedMutation,
} from "@/lib/offline-queue";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import {
  Wifi,
  WifiOff,
  RefreshCw,
  Database,
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  Layers,
  CheckSquare,
  Truck,
  BarChart3,
} from "lucide-react";

export function Header() {
  const pathname = usePathname();
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [queuedItems, setQueuedItems] = useState<QueuedMutation[]>([]);
  const [isRestoring, setIsRestoring] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    // Initial online status
    if (typeof window !== "undefined") {
      setIsOnline(navigator.onLine);

      const handleOnline = () => {
        setIsOnline(true);
        replayOfflineQueue();
      };
      const handleOffline = () => setIsOnline(false);

      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      // Register PWA Service Worker
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
          console.warn("SW registration note:", err);
        });
      }

      const unsubscribe = subscribeToOfflineQueue((count, syncing) => {
        setPendingCount(count);
        setIsSyncing(syncing);
      });

      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
        unsubscribe();
      };
    }
  }, []);

  const handleOpenQueue = async () => {
    const items = await getAllQueuedItems();
    setQueuedItems(items);
    setIsQueueOpen(true);
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    await replayOfflineQueue();
    const items = await getAllQueuedItems();
    setQueuedItems(items);
    setIsSyncing(false);
  };

  const handleBackup = () => {
    window.location.href = "/api/backup";
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm(`Restore database from '${file.name}'? This will overwrite the current SQLite data.`)) {
      e.target.value = "";
      return;
    }

    setIsRestoring(true);
    setStatusMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/restore", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        alert("Database restored successfully! The page will now reload.");
        window.location.reload();
      } else {
        alert(`Restore failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      alert(`Restore failed: ${err.message}`);
    } finally {
      setIsRestoring(false);
      e.target.value = "";
    }
  };

  const navLinks = [
    { href: "/qc", label: "QC Queue", icon: CheckSquare },
    { href: "/rolls", label: "Rolls & Labels", icon: Layers },
    { href: "/dispatch", label: "Dispatch", icon: Truck },
    { href: "/defects", label: "Defect Analytics", icon: BarChart3 },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo and Brand */}
            <div className="flex items-center gap-6">
              <Link href="/qc" className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black text-lg shadow-sm">
                  TL
                </div>
                <div>
                  <span className="font-extrabold text-slate-900 tracking-tight text-base sm:text-lg block leading-none">
                    ThreadLine
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">
                    Everest Mills
                  </span>
                </div>
              </Link>

              {/* Desktop Nav */}
              <nav className="hidden md:flex items-center gap-1">
                {navLinks.map((item) => {
                  const isActive = pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                        isActive
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Right Actions: Sync Indicator & DB Tools */}
            <div className="flex items-center gap-2.5">
              {/* Sync Status Indicator Pill */}
              <button
                onClick={handleOpenQueue}
                title="Click to view offline sync queue"
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  !isOnline
                    ? "bg-rose-50 text-rose-700 border-rose-200"
                    : isSyncing
                    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                    : pendingCount > 0
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200"
                }`}
              >
                {!isOnline ? (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-rose-600" />
                    <span>Offline {pendingCount > 0 ? `(${pendingCount} pending)` : ""}</span>
                  </>
                ) : isSyncing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                    <span>Syncing ({pendingCount} pending)</span>
                  </>
                ) : pendingCount > 0 ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                    <span>Sync Pending ({pendingCount})</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Online</span>
                  </>
                )}
              </button>

              {/* DB Backup & Restore Controls */}
              <div className="hidden sm:flex items-center gap-1 border-l border-slate-200 pl-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBackup}
                  title="Export SQLite database"
                  className="text-xs text-slate-600"
                >
                  <Download className="w-3.5 h-3.5 mr-1 text-slate-500" />
                  Backup DB
                </Button>

                <label
                  className="cursor-pointer inline-flex items-center justify-center font-medium rounded-lg transition-colors text-xs px-2.5 py-1.5 gap-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  title="Restore SQLite database from file"
                >
                  <Upload className="w-3.5 h-3.5 text-slate-500" />
                  Restore
                  <input
                    type="file"
                    accept=".db"
                    onChange={handleRestore}
                    disabled={isRestoring}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Navigation bar */}
        <div className="md:hidden flex border-t border-slate-100 bg-slate-50 px-2 py-1 justify-around">
          {navLinks.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center py-1 px-2 text-[10px] font-semibold rounded-md ${
                  isActive ? "text-indigo-600 font-bold" : "text-slate-500"
                }`}
              >
                <Icon className="w-4 h-4 mb-0.5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </header>

      {/* Offline Queue Drawer */}
      <Drawer
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
        title="Offline Sync Queue"
      >
        <div className="space-y-4">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">Connection Status:</span>
              <span className={`font-bold ${isOnline ? "text-emerald-600" : "text-rose-600"}`}>
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">Pending Actions:</span>
              <span className="font-bold text-slate-900">{queuedItems.length}</span>
            </div>
            <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
              When disconnected, inspections, scans, and logs are safely saved to IndexedDB and automatically replayed once reconnected.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleManualSync}
              isLoading={isSyncing}
              disabled={!isOnline || queuedItems.length === 0}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" />
              Sync Now
            </Button>
          </div>

          {queuedItems.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
              No pending actions in queue. All data is synchronized.
            </div>
          ) : (
            <div className="space-y-2">
              {queuedItems.map((item) => (
                <div
                  key={item.id}
                  className="p-3 bg-white border border-slate-200 rounded-lg text-xs space-y-1 shadow-2xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 uppercase">{item.type}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        item.status === "failed"
                          ? "bg-rose-100 text-rose-700"
                          : item.status === "syncing"
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {item.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-slate-500 font-mono text-[10px] truncate">
                    {item.method} {item.url}
                  </div>
                  {item.lastError && (
                    <div className="text-rose-600 text-[11px] font-medium flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {item.lastError}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-400">
                    Created: {new Date(item.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Drawer>
    </>
  );
}
