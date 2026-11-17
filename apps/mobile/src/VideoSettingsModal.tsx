import { Film, RotateCcw, Save, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button, colors, s } from "./ui";
import { useWorkspace } from "./workspace";

type FieldDef =
  | { key: string; label: string; hint?: string; kind: "bool" }
  | { key: string; label: string; hint?: string; kind: "number"; min?: number; max?: number }
  | {
      key: string;
      label: string;
      hint?: string;
      kind: "text";
      multiline?: boolean;
      presets?: string[];
    }
  | {
      key: string;
      label: string;
      hint?: string;
      kind: "choice";
      options: Array<{ value: string; label: string }>;
    };

type StudioTab = "video" | "image" | "audio" | "vision" | "models" | "presets";
type InventoryGroup = {
  id: string;
  label: string;
  settingKey: string;
  dirs: string[];
  installNote: string;
  files: string[];
};
type SettingConflict = {
  id: string;
  severity: "error" | "warning";
  title: string;
  detail: string;
  fixLabel?: string;
  fixPatch?: Record<string, string | number | boolean>;
};
type InventoryPayload = {
  groups: InventoryGroup[];
  mismatches?: string[];
  families?: Record<string, string>;
  conflicts?: SettingConflict[];
  synced?: boolean;
};
type StudioPayload = {
  settings: Record<string, string | number | boolean>;
  schema: Array<{ tab?: StudioTab; section: string; fields: FieldDef[] }>;
};

export function VideoSettingsModal({ onClose }: { onClose: () => void }) {
  const { api, notify } = useWorkspace();
  const [data, setData] = useState<StudioPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<StudioTab>("video");
  const [inventory, setInventory] = useState<InventoryPayload | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [families, setFamilies] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<SettingConflict[]>([]);
  const validateDraft = async (nextSettings: Record<string, string | number | boolean>) => {
    try {
      const res = await api.request<{
        families?: Record<string, string>;
        conflicts?: SettingConflict[];
      }>("/api/comfy-inventory/validate", nextSettings);
      if (res?.families) setFamilies(res.families);
      if (Array.isArray(res?.conflicts)) setConflicts(res.conflicts);
    } catch {}
  };
  const [llmMode, setLlmMode] = useState<"q4" | "q5" | "cloud">("q4");
  const switchLlm = async (mode: "q4" | "q5" | "cloud", label: string) => {
    setLlmMode(mode);
    try {
      await api.request("/api/model-settings", { mode });
      notify(`Active LLM switched to ${label}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not switch LLM");
    }
  };
  const loadInventory = async (verify = false) => {
    setVerifying(true);
    try {
      const res = await api.request<InventoryPayload>(
        verify ? "/api/comfy-inventory/verify" : "/api/comfy-inventory",
        verify ? { autoSync: true } : undefined,
      );
      const rawInv = (
        res as unknown as { inventory?: InventoryGroup[] | InventoryPayload; issues?: string[] }
      )?.inventory;
      const groups = Array.isArray(rawInv)
        ? rawInv
        : ((rawInv as InventoryPayload | undefined)?.groups ?? (res as InventoryPayload)?.groups);
      const issues =
        (res as unknown as { issues?: string[] })?.issues ??
        (res as InventoryPayload)?.mismatches ??
        [];
      const fams = (res as unknown as { families?: Record<string, string> })?.families;
      const confs = (res as unknown as { conflicts?: SettingConflict[] })?.conflicts;
      if (fams) setFamilies(fams);
      if (Array.isArray(confs)) setConflicts(confs);
      if (groups) setInventory({ groups, mismatches: issues, families: fams, conflicts: confs });
      if (verify) {
        const fresh = await api.request<StudioPayload>("/api/video-settings");
        if (fresh) setData(fresh);
        const mm = issues;
        notify(
          mm?.length
            ? `Synced ${mm.length} missing model reference(s) with disk`
            : "Filesystem verified: all selections match disk",
        );
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not scan ComfyUI models");
    } finally {
      setVerifying(false);
    }
  };
  useEffect(() => {
    void loadInventory(false);
    void api
      .request<{ mode?: "q4" | "q5" | "cloud" }>("/api/model-settings")
      .then((r) => {
        if (r?.mode === "q4" || r?.mode === "q5" || r?.mode === "cloud") setLlmMode(r.mode);
      })
      .catch(() => {});
  }, []);
  const [numDrafts, setNumDrafts] = useState<Record<string, string>>({});
  const [initialSettings, setInitialSettings] = useState<Record<
    string,
    string | number | boolean
  > | null>(null);
  const stableSnap = (obj: Record<string, string | number | boolean> | null | undefined) =>
    obj
      ? JSON.stringify(
          Object.keys(obj)
            .sort()
            .map((k) => [k, obj[k]]),
        )
      : "";
  const dirty = Boolean(
    data && initialSettings && stableSnap(data.settings) !== stableSnap(initialSettings),
  );
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const handleClose = () => {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };
  const applyPreset = (preset: "draft" | "cinema") => {
    setConfirmDiscard(false);
    setData((prev) =>
      prev
        ? {
            ...prev,
            settings: {
              ...prev.settings,
              ...(preset === "draft"
                ? {
                    resolutionMode: "fast_960x544",
                    fastMode: true,
                    loraStrength: 0.5,
                    i2vImgCompression: 8,
                    baseSigmas:
                      "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0",
                    upscaleSigmas: "0.85, 0.7250, 0.4219, 0.0",
                    imageSteps: 8,
                  }
                : {
                    resolutionMode: "hd_1280x720",
                    fastMode: false,
                    loraStrength: 0.25,
                    i2vImgCompression: 0,
                    baseSigmas:
                      "1.0, 0.99, 0.98, 0.97, 0.95, 0.92, 0.88, 0.83, 0.77, 0.70, 0.62, 0.54, 0.45, 0.36, 0.27, 0.18, 0.09, 0.0",
                    upscaleSigmas: "0.85, 0.75, 0.65, 0.52, 0.38, 0.22, 0.0",
                    imageSteps: 28,
                  }),
            },
          }
        : prev,
    );
    notify(
      preset === "draft"
        ? "Applied Draft (8-Step Fast) preset."
        : "Applied Cinema Quality (20-Step HD) preset.",
    );
  };

  useEffect(() => {
    void api.request<StudioPayload>("/api/video-settings").then((res) => {
      setData(res);
      if (res?.settings) setInitialSettings(res.settings);
    });
  }, [api]);

  const setVal = (key: string, val: string | number | boolean) => {
    setConfirmDiscard(false);
    setData((prev) => {
      if (!prev) return prev;
      const nextSettings = { ...prev.settings, [key]: val };
      void validateDraft(nextSettings);
      return { ...prev, settings: nextSettings };
    });
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const saved = await api.request<StudioPayload>("/api/video-settings", data.settings);
      setData(saved);
      if (saved?.settings) setInitialSettings(saved.settings);
      setConfirmDiscard(false);
      notify("Studio settings saved.");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const resetRes = await api.request<StudioPayload>("/api/video-settings/reset", {});
      setData(resetRes);
      if (resetRes?.settings) setInitialSettings(resetRes.settings);
      setNumDrafts({});
      setConfirmDiscard(false);
      notify("Reset to recommended RTX 3090 defaults.");
    } finally {
      setSaving(false);
    }
  };

  const renderField = (f: FieldDef) => {
    const val = data?.settings[f.key];
    if (f.kind === "bool") {
      return (
        <View key={f.key} style={[s.row, { justifyContent: "space-between", paddingVertical: 2 }]}>
          <Text style={{ fontSize: 13, color: "#E4E4E7", flex: 1 }}>{f.label}</Text>
          <Switch value={Boolean(val)} onValueChange={(v) => setVal(f.key, v)} />
        </View>
      );
    }
    if (f.kind === "choice") {
      return (
        <View key={f.key} style={{ gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#D4D4D8" }}>{f.label}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {f.options.map((opt) => {
              const active = String(val) === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setVal(f.key, opt.value)}
                  style={{
                    paddingHorizontal: 11,
                    paddingVertical: 6,
                    borderRadius: 14,
                    backgroundColor: active ? "#1D4ED8" : "#27272A",
                    borderWidth: 1,
                    borderColor: active ? "#3B82F6" : "#3F3F46",
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: "#FAFAFA" }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    }
    if (f.kind === "number") {
      return (
        <View key={f.key} style={{ flex: 1, minWidth: 140, gap: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#D4D4D8" }}>{f.label}</Text>
          <TextInput
            value={numDrafts[f.key] ?? String(val ?? "")}
            onChangeText={(t) => {
              const cleaned = t.replace(/[^0-9.-]/g, "");
              setNumDrafts((p) => ({ ...p, [f.key]: cleaned }));
              if (cleaned !== "" && cleaned !== "." && cleaned !== "-" && !cleaned.endsWith(".")) {
                const n = Number(cleaned);
                if (!Number.isNaN(n)) setVal(f.key, n);
              }
            }}
            onBlur={() =>
              setNumDrafts((p) => {
                const next = { ...p };
                delete next[f.key];
                return next;
              })
            }
            keyboardType="numeric"
            style={{
              backgroundColor: "#18181B",
              color: "#FAFAFA",
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 7,
              fontSize: 13,
              borderWidth: 1,
              borderColor: "#3F3F46",
            }}
          />
          {!!f.hint && <Text style={{ fontSize: 10, color: "#A1A1AA" }}>{f.hint}</Text>}
        </View>
      );
    }
    return (
      <View key={f.key} style={{ gap: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: "#D4D4D8" }}>{f.label}</Text>
        {!!f.presets && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {f.presets.map((p) => (
              <Pressable
                key={p || "none"}
                onPress={() => setVal(f.key, p)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 14,
                  backgroundColor: String(val) === p ? "#1D4ED8" : "#27272A",
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "600", color: "#FAFAFA" }}>
                  {p || "None"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <TextInput
          value={String(val ?? "")}
          onChangeText={(t) => setVal(f.key, t)}
          multiline={f.multiline}
          style={{
            backgroundColor: "#18181B",
            color: "#FAFAFA",
            borderRadius: 10,
            padding: 10,
            fontSize: 13,
            minHeight: f.multiline ? 52 : undefined,
            borderWidth: 1,
            borderColor: "#3F3F46",
          }}
        />
      </View>
    );
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.68)",
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 680,
            maxHeight: "90%",
            backgroundColor: "#1C1C1F",
            borderRadius: 24,
            padding: 20,
            borderWidth: 1,
            borderColor: "#2E2E32",
          }}
        >
          <View style={[s.row, { justifyContent: "space-between", marginBottom: 14 }]}>
            <View style={[s.row, { gap: 9 }]}>
              <Film size={20} color="#60A5FA" />
              <Text style={{ fontSize: 18, fontWeight: "700", color: "#FAFAFA" }}>
                Studio Settings · All Pipelines
              </Text>
            </View>
            <Pressable
              onPress={handleClose}
              style={{ padding: 6, backgroundColor: "#27272A", borderRadius: 16 }}
            >
              <X size={18} color="#E4E4E7" />
            </Pressable>
          </View>
          <View
            style={[
              s.row,
              { justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 10 },
            ]}
          >
            <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
              {(
                [
                  ["video", "Video (LTX-2.3)"],
                  ["image", "Image"],
                  ["audio", "Voice & Audio"],
                  ["vision", "Vision & Clone"],
                  ["models", "Models & Components"],
                  ["presets", "LLM & Presets"],
                ] as Array<[StudioTab, string]>
              ).map(([id, label]) => (
                <Pressable
                  key={id}
                  onPress={() => setActiveTab(id)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 12,
                    backgroundColor: activeTab === id ? "#1D4ED8" : "#27272A",
                  }}
                >
                  <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#FAFAFA" }}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {conflicts.length > 0 && (
            <View style={{ gap: 6, marginBottom: 10 }}>
              {conflicts.map((c) => {
                const isErr = c.severity === "error";
                return (
                  <View
                    key={c.id}
                    style={{
                      padding: 10,
                      borderRadius: 12,
                      backgroundColor: isErr ? "rgba(239,68,68,0.16)" : "rgba(245,158,11,0.15)",
                      borderWidth: 1,
                      borderColor: isErr ? "#EF4444" : "#F59E0B",
                      gap: 5,
                    }}
                  >
                    <View
                      style={[s.row, { justifyContent: "space-between", flexWrap: "wrap", gap: 6 }]}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "700",
                          color: isErr ? "#FCA5A5" : "#FCD34D",
                        }}
                      >
                        {isErr ? "⛔ " : "⚠️ "}
                        {c.title}
                      </Text>
                      {c.fixLabel && c.fixPatch && (
                        <Pressable
                          onPress={() => {
                            setData((prev) => {
                              if (!prev) return prev;
                              const nextSettings = { ...prev.settings, ...c.fixPatch };
                              void validateDraft(nextSettings);
                              return { ...prev, settings: nextSettings };
                            });
                            notify(`Applied fix: ${c.fixLabel}`);
                          }}
                          style={{
                            paddingHorizontal: 9,
                            paddingVertical: 4,
                            borderRadius: 8,
                            backgroundColor: isErr ? "#DC2626" : "#D97706",
                          }}
                        >
                          <Text style={{ fontSize: 10.5, fontWeight: "700", color: "#FFF" }}>
                            {c.fixLabel}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                    <Text style={{ fontSize: 11, lineHeight: 15, color: "#E4E4E7" }}>
                      {c.detail}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
          {!data ? (
            <ActivityIndicator color="#60A5FA" style={{ marginVertical: 40 }} />
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 14, paddingBottom: 14 }}
            >
              {activeTab === "presets" && (
                <View style={{ gap: 14, paddingBottom: 12 }}>
                  <View
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      backgroundColor: "#242428",
                      gap: 10,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#FAFAFA" }}>
                      1. Chat & Reasoning LLM (llama.cpp / Cloud)
                    </Text>
                    <Text style={{ fontSize: 11.5, lineHeight: 17, color: "#A1A1AA" }}>
                      Selects the brain that interprets your chat requests, writes prompts, and
                      orchestrates image, video, audio, and vision tools. Syncs live with the top
                      header pill.
                    </Text>
                    <View style={{ gap: 8 }}>
                      {(
                        [
                          {
                            id: "q4",
                            label: "Qwen3 8B (Local Q4_K_M)",
                            desc: "Fast local reasoning via llama.cpp (~5.5 GB VRAM). Leaves maximum VRAM headroom for ComfyUI image and video renders with zero cloud filtering.",
                          },
                          {
                            id: "q5",
                            label: "Qwen3 14B (Local Q5_K_M)",
                            desc: "Higher-precision local reasoning via llama.cpp (~10.5 GB VRAM). Best local choice for complex multi-step tool chains and strict prompt adherence.",
                          },
                          {
                            id: "cloud",
                            label: "Gemini (Cloud API)",
                            desc: "Cloud-hosted reasoning (0 GB local VRAM) with a 1M token context window. Note: subject to external cloud content policies.",
                          },
                        ] as const
                      ).map((opt) => {
                        const active = llmMode === opt.id;
                        return (
                          <Pressable
                            key={opt.id}
                            onPress={() =>
                              void switchLlm(opt.id, opt.label.split(" (").at(0) || opt.label)
                            }
                            style={{
                              padding: 12,
                              borderRadius: 12,
                              backgroundColor: active ? "rgba(29,78,216,0.22)" : "#18181B",
                              borderWidth: 1,
                              borderColor: active ? "#60A5FA" : "#2E2E32",
                              gap: 4,
                            }}
                          >
                            <View style={[s.row, { justifyContent: "space-between" }]}>
                              <Text style={{ fontSize: 12.5, fontWeight: "700", color: "#FAFAFA" }}>
                                {opt.label}
                              </Text>
                              <Text
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: "700",
                                  color: active ? "#60A5FA" : "#71717A",
                                }}
                              >
                                {active ? "ACTIVE" : "Select"}
                              </Text>
                            </View>
                            <Text style={{ fontSize: 11, lineHeight: 16, color: "#A1A1AA" }}>
                              {opt.desc}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      backgroundColor: "#242428",
                      gap: 10,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#FAFAFA" }}>
                      2. One-Click Pipeline Quality & Speed Presets
                    </Text>
                    <Text style={{ fontSize: 11.5, lineHeight: 17, color: "#A1A1AA" }}>
                      Applies coordinated step counts, resolutions, LoRA weights, and identity
                      conditioning across both Image and Video (LTX-2.3) pipelines. Click Save
                      Studio Settings below after applying.
                    </Text>
                    <View style={{ gap: 8 }}>
                      <Pressable
                        onPress={() => {
                          applyPreset("draft");
                          notify(
                            "Applied Draft (8-Step) preset — click Save Studio Settings to persist",
                          );
                        }}
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          backgroundColor: "#18181B",
                          borderWidth: 1,
                          borderColor: "#3F3F46",
                          gap: 4,
                        }}
                      >
                        <Text style={{ fontSize: 12.5, fontWeight: "700", color: "#FAFAFA" }}>
                          ⚡ Draft (8-Step) — Fast Iteration
                        </Text>
                        <Text style={{ fontSize: 11, lineHeight: 16, color: "#A1A1AA" }}>
                          Sets Video to 960×544 (fast 8-step sigmas, LoRA 0.50, I2V compression 8)
                          and Image to 8 steps. Ideal for rapid composition tests and motion
                          previews.
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          applyPreset("cinema");
                          notify(
                            "Applied Cinema Quality preset — click Save Studio Settings to persist",
                          );
                        }}
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          backgroundColor: "rgba(20,83,45,0.35)",
                          borderWidth: 1,
                          borderColor: "#22C55E",
                          gap: 4,
                        }}
                      >
                        <Text style={{ fontSize: 12.5, fontWeight: "700", color: "#DCFCE7" }}>
                          🎬 Cinema Quality — Maximum Detail & Identity Lock
                        </Text>
                        <Text style={{ fontSize: 11, lineHeight: 16, color: "#BBF7D0" }}>
                          Sets Video to 1280×720 HD (18-step sigmas, LoRA 0.25, I2V compression 0
                          for strict full-body and face lock) and Image to 28 steps.
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              )}
              {activeTab === "models" && (
                <View style={{ gap: 14, paddingBottom: 12 }}>
                  <View
                    style={[
                      s.row,
                      {
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 8,
                        padding: 12,
                        borderRadius: 14,
                        backgroundColor: "#18181B",
                        borderWidth: 1,
                        borderColor: "#2E2E32",
                      },
                    ]}
                  >
                    <View style={{ flex: 1, minWidth: 200 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: "#FAFAFA" }}>
                        ComfyUI Filesystem Inventory
                      </Text>
                      <Text style={{ fontSize: 11, color: "#A1A1AA" }}>
                        Scanned live from /home/cowboy/ComfyUI/models/
                      </Text>
                    </View>
                    <Pressable
                      disabled={verifying}
                      onPress={() => void loadInventory(true)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 12,
                        backgroundColor: "#1D4ED8",
                      }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#FFF" }}>
                        {verifying ? "Scanning Disk…" : "Verify & Sync Filesystem"}
                      </Text>
                    </Pressable>
                  </View>
                  <View
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      backgroundColor: "#18181B",
                      borderWidth: 1,
                      borderColor: "#27272A",
                      gap: 6,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#E4E4E7" }}>
                      Custom Model Storage Directories (Auto-Symlinked to ComfyUI)
                    </Text>
                    <Text style={{ fontSize: 11, color: "#A1A1AA" }}>
                      Add Windows (A:\AI_Models) or Linux (/mnt/a/AI_Models) model root paths
                      separated by commas or new lines.
                    </Text>
                    <View style={[s.row, { gap: 8 }]}>
                      <TextInput
                        value={String(data.settings.customModelDirs ?? "/mnt/a/AI_Models")}
                        onChangeText={(t) => setVal("customModelDirs", t)}
                        placeholder="/mnt/a/AI_Models or A:\AI_Models"
                        placeholderTextColor="#71717A"
                        style={{
                          flex: 1,
                          backgroundColor: "#121215",
                          color: "#FAFAFA",
                          borderRadius: 10,
                          paddingHorizontal: 10,
                          paddingVertical: 7,
                          fontSize: 12.5,
                          borderWidth: 1,
                          borderColor: "#3F3F46",
                        }}
                      />
                      <Pressable
                        disabled={verifying}
                        onPress={async () => {
                          await api.request("/api/video-settings", {
                            customModelDirs: String(
                              data.settings.customModelDirs ?? "/mnt/a/AI_Models",
                            ),
                          });
                          await loadInventory(true);
                        }}
                        style={{
                          paddingHorizontal: 11,
                          paddingVertical: 8,
                          borderRadius: 10,
                          backgroundColor: "#14532D",
                          borderWidth: 1,
                          borderColor: "#22C55E",
                        }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#DCFCE7" }}>
                          Link & Scan
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                  {!!inventory?.mismatches?.length && (
                    <View
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        backgroundColor: "rgba(245,158,11,0.14)",
                        borderWidth: 1,
                        borderColor: "#F59E0B",
                      }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#FCD34D" }}>
                        Updated missing disk references: {inventory.mismatches.join(", ")}
                      </Text>
                    </View>
                  )}
                  {!inventory ? (
                    <ActivityIndicator color="#60A5FA" style={{ marginVertical: 20 }} />
                  ) : (
                    inventory.groups.map((grp) => {
                      const curVal = String(data.settings[grp.settingKey] ?? "");
                      return (
                        <View
                          key={grp.id}
                          style={{
                            padding: 12,
                            borderRadius: 14,
                            backgroundColor: "#18181B",
                            borderWidth: 1,
                            borderColor: "#27272A",
                            gap: 8,
                          }}
                        >
                          <View
                            style={[
                              s.row,
                              { justifyContent: "space-between", flexWrap: "wrap", gap: 6 },
                            ]}
                          >
                            <Text style={{ fontSize: 12.5, fontWeight: "700", color: "#E4E4E7" }}>
                              {grp.label} ({grp.files.length})
                            </Text>
                            <Text style={{ fontSize: 10.5, color: "#71717A" }}>
                              {grp.dirs.join(" · ")}
                            </Text>
                          </View>
                          {grp.files.length === 0 ? (
                            <View
                              style={{
                                padding: 10,
                                borderRadius: 10,
                                backgroundColor: "#121215",
                                borderWidth: 1,
                                borderColor: "#27272A",
                                gap: 3,
                              }}
                            >
                              <Text style={{ fontSize: 11.5, fontWeight: "600", color: "#A1A1AA" }}>
                                None found / none installed
                              </Text>
                              <Text style={{ fontSize: 11, color: "#71717A" }}>
                                {grp.installNote}
                              </Text>
                            </View>
                          ) : (
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                              <Pressable
                                onPress={() => setVal(grp.settingKey, "")}
                                style={{
                                  paddingHorizontal: 10,
                                  paddingVertical: 5,
                                  borderRadius: 12,
                                  backgroundColor: !curVal ? "#1D4ED8" : "#27272A",
                                }}
                              >
                                <Text style={{ fontSize: 11, fontWeight: "600", color: "#FAFAFA" }}>
                                  Default / None
                                </Text>
                              </Pressable>
                              {grp.files.map((file) => {
                                const selected = curVal === file;
                                return (
                                  <Pressable
                                    key={file}
                                    onPress={() => setVal(grp.settingKey, file)}
                                    style={{
                                      paddingHorizontal: 10,
                                      paddingVertical: 5,
                                      borderRadius: 12,
                                      backgroundColor: selected ? "#1D4ED8" : "#27272A",
                                      borderWidth: selected ? 1 : 0,
                                      borderColor: "#60A5FA",
                                    }}
                                  >
                                    <Text
                                      style={{ fontSize: 11, fontWeight: "600", color: "#FAFAFA" }}
                                    >
                                      {file}
                                      {families[file] ? ` [${families[file]}]` : ""}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      );
                    })
                  )}
                </View>
              )}
              {data.schema
                .filter((sec) => (sec.tab ?? "video") === activeTab)
                .map((sec) => (
                  <View
                    key={sec.section}
                    style={{ gap: 10, padding: 14, backgroundColor: "#242428", borderRadius: 16 }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#FAFAFA" }}>
                      {sec.section}
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                      {sec.fields.map((f) => (
                        <View
                          key={f.key}
                          style={{ width: f.kind === "number" ? "48%" : "100%", flexGrow: 1 }}
                        >
                          {renderField(f)}
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
            </ScrollView>
          )}
          {confirmDiscard && (
            <View
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 12,
                backgroundColor: "rgba(245,158,11,0.16)",
                borderWidth: 1,
                borderColor: "#F59E0B",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#FCD34D", flex: 1 }}>
                You have unsaved changes. Save before closing?
              </Text>
              <View style={[s.row, { gap: 6 }]}>
                <Pressable
                  onPress={() => setConfirmDiscard(false)}
                  style={{
                    paddingHorizontal: 9,
                    paddingVertical: 5,
                    borderRadius: 8,
                    backgroundColor: "#27272A",
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "600", color: "#E4E4E7" }}>
                    Keep Editing
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setConfirmDiscard(false);
                    onClose();
                  }}
                  style={{
                    paddingHorizontal: 9,
                    paddingVertical: 5,
                    borderRadius: 8,
                    backgroundColor: "#7F1D1D",
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#FECACA" }}>
                    Discard & Close
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void save()}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 8,
                    backgroundColor: "#1D4ED8",
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#FFF" }}>
                    Save & Close
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
          <View style={[s.row, { justifyContent: "space-between", marginTop: 12, gap: 8 }]}>
            <Button small onPress={() => void reset()} disabled={saving}>
              <View style={[s.row, { gap: 5 }]}>
                <RotateCcw size={14} color={colors.text} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.text }}>
                  Reset Defaults
                </Text>
              </View>
            </Button>
            <View style={[s.row, { gap: 10 }]}>
              {dirty && (
                <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#FBBF24" }}>
                  ● Unsaved changes
                </Text>
              )}
              <Button primary onPress={() => void save()} disabled={saving || !data}>
                <View style={[s.row, { gap: 6 }]}>
                  <Save size={15} color="#FFF" />
                  <Text style={{ fontSize: 13, fontWeight: "600", color: "#FFF" }}>
                    {saving ? "Saving..." : "Save Studio Settings"}
                  </Text>
                </View>
              </Button>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
