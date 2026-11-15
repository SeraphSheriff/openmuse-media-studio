import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import { StatusBar } from "expo-status-bar";
import {
  Bell,
  Check,
  CircleHelp,
  Lightbulb,
  type LucideIcon,
  Menu,
  MessageCircle,
  PanelsTopLeft,
  Shapes,
  SquareCheck,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Section, Workspace } from "../../packages/domain/src";
import {
  AgentActivityScreen,
  AgentStatus,
  AppsScreen,
  GoalsScreen,
  IdeasScreen,
} from "./src/agent-ui";
import { AgentWorkspaceProvider, useAgentWorkspace } from "./src/agent-workspace";
import { API_URL, createSession, MuseApi } from "./src/api";
import { ChatScreen, WorkspaceTools } from "./src/chat";
import { ComputerEntry } from "./src/computer";
import { ComputerDraftProvider } from "./src/computer-drafts";
import { Details } from "./src/details";
import { BrowserScreen, CalendarScreen, FilesScreen, MailScreen } from "./src/screens";
import { useThemeMode } from "./src/theme";
import { ThreadsProvider, ThreadsSheet, useMuseThread } from "./src/threads";
import {
  Button,
  Card,
  colors,
  ErrorNotice,
  Field,
  IconButton,
  Mascot,
  notifyAvatarUpdated,
  Sheet,
  s,
} from "./src/ui";
import { VideoSettingsModal } from "./src/VideoSettingsModal";
import { type Detail, useWorkspace, WorkspaceContext } from "./src/workspace";

const nav: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "activity", label: "Activity", icon: PanelsTopLeft },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
  { id: "goals", label: "Goals", icon: SquareCheck },
  { id: "apps", label: "Apps", icon: Shapes },
  { id: "help", label: "Help", icon: CircleHelp },
];
const titles: Partial<Record<Section, { title: string; subtitle: string }>> = {
  activity: { title: "Activity", subtitle: "Plans, progress, decisions and results." },
  ideas: { title: "Ideas", subtitle: "Useful next steps, grounded in your world." },
  goals: {
    title: "Goals",
    subtitle: "Longer-term goals and things to keep an eye on.",
  },
  apps: {
    title: "Apps",
    subtitle: "Connections, capabilities and what your agent remembers.",
  },
  help: {
    title: "Studio Help & Prompts",
    subtitle: "Directions, tips, and 1-click example prompts for all local media tools.",
  },
  connections: { title: "Apps", subtitle: "Connections and capabilities." },
  mail: { title: "Mail", subtitle: "The conversations behind your work." },
  calendar: { title: "Calendar", subtitle: "Time for what matters." },
  browser: { title: "Browser", subtitle: "Your connected browsing sessions." },
  files: { title: "Files", subtitle: "Documents, forms and filled copies." },
};
interface ComfyControlState {
  lines: Array<{ id: string; text: string }>;
  vramUsedGb: number;
  vramTotalGb: number;
  running: number;
  pending: number;
}

function HelpScreen() {
  const [copiedId, setCopiedId] = useState("");
  const copyPrompt = (id: string, prompt: string) => {
    setCopiedId(id);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(prompt).catch(() => {});
    }
  };

  const guides = [
    {
      id: "voice",
      badge: "Qwen3-TTS 1.7B · Zero-Shot Voice Cloning",
      title: "1. Record & Clone Your Voice + Add to Video",
      steps: [
        "Click ● Record Voice Sample (Mic) in the right Media Studio panel (or drop any 3–15s .wav/.mp3 clip into the dropzone). Recordings auto-convert to 24kHz mono .wav and copy their filename.",
        "Paste the filename into a chat prompt with the new dialogue you want spoken. Optional: include the exact words spoken in your sample for even closer cadence matching.",
        "Once voice-<timestamp>.mp3 appears in Media Studio, ask OpenMuse to mux or mix it onto any .mp4 video.",
      ],
      examples: [
        {
          id: "ex-voice-1",
          label: "Generate Cloned Voiceover",
          prompt:
            'Use mic-voice-1794719963669.wav to say: "Welcome back to OpenMuse Media Studio. Everything is running locally on the Predator workstation."',
        },
        {
          id: "ex-voice-2",
          label: "Add Voiceover to Video",
          prompt: "Add voice-123.mp3 onto video-456.mp4",
        },
      ],
    },
    {
      id: "image",
      badge: "Z-Image-Turbo · Local ComfyUI",
      title: "2. Generate & Edit Images",
      steps: [
        "Describe any scene, portrait, or concept in chat—OpenMuse renders locally via Z-Image-Turbo and drops the result into Media Studio.",
        "To edit an existing image, drop it into Media Studio (or click Copy on any gallery card) and ask OpenMuse to restyle, swap outfits, or adjust lighting.",
      ],
      examples: [
        {
          id: "ex-img-1",
          label: "Generate New Image",
          prompt:
            "Generate a cinematic 35mm portrait of a cyberpunk detective standing in neon rain at night.",
        },
        {
          id: "ex-img-2",
          label: "Edit Existing Image",
          prompt:
            "Edit image-123.png to change the background to a sunset desert highway with warm golden hour lighting.",
        },
      ],
    },
    {
      id: "vision",
      badge: "Qwen2.5-VL 7B + OpenCV Poisson Blending",
      title: "3. Visual Inspection & Seamless Feature Cloning",
      steps: [
        "Ask OpenMuse to inspect any image in generated/—Qwen2.5-VL spins up on-demand, analyzes details or locates coordinates, and immediately frees VRAM afterward.",
        "Use copy_region to transfer a specific detail (tattoo, facial feature, object) from one person or image onto another with automatic skin-tone and lighting blending.",
      ],
      examples: [
        {
          id: "ex-vis-1",
          label: "Inspect Image Details",
          prompt:
            "Inspect uploaded-photo.png and describe the lighting, pose, and exact positions of the subjects.",
        },
        {
          id: "ex-vis-2",
          label: "Seamless Feature Copy",
          prompt:
            "Copy the tattoo from the left person in photo.png onto the right person's forearm using seamless cloning.",
        },
      ],
    },
    {
      id: "video",
      badge: "LTX-2.3 Uncensored · T2V & I2V",
      title: "4. Text-to-Video & Image-to-Video Animation",
      steps: [
        "Click Video Studio in the top-left menu (☰) to switch between Text-to-Video (T2V) and Image-to-Video (I2V) workflow templates or set default clip length.",
        "Ask OpenMuse to generate a clip from a prompt or animate any image from your right-side Media Studio gallery.",
      ],
      examples: [
        {
          id: "ex-vid-1",
          label: "Animate a Gallery Image",
          prompt:
            "Animate image-123.png into a 5-second slow-motion tracking shot with wind blowing through hair and dust particles in the air.",
        },
      ],
    },
    {
      id: "workspace",
      badge: "Workstation Controls & Shortcuts",
      title: "5. Panels, Logs, Avatar & Memory Tips",
      steps: [
        "Resizable Side Panels: Drag the thin vertical slider on the inner edge of either side dock to widen it up to the chat column; double-click the grabber dot to reset.",
        "Console Log Filters: Switch between All, Info, Warn, and Error while color-coded badges distinguish ComfyUI, LLM, Vision, and Studio logs.",
        "On-the-Fly Avatar: Click your avatar in the top header to upload a custom image anytime, or click Avatar on any image card in Media Studio.",
      ],
      examples: [],
    },
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}>
      {guides.map((g) => (
        <Card key={g.id} style={{ gap: 10 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.blue }}>{g.badge}</Text>
          <Text style={s.heading}>{g.title}</Text>
          <View style={{ gap: 6 }}>
            {g.steps.map((step) => (
              <Text key={step} style={[s.muted, { lineHeight: 19 }]}>
                • {step}
              </Text>
            ))}
          </View>
          {g.examples.length > 0 ? (
            <View style={{ gap: 8, marginTop: 4 }}>
              {g.examples.map((ex) => (
                <View
                  key={ex.id}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    backgroundColor: colors.canvas,
                    borderWidth: 1,
                    borderColor: colors.line,
                    gap: 6,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.text }}>
                      {ex.label}
                    </Text>
                    <Pressable
                      onPress={() => copyPrompt(ex.id, ex.prompt)}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 6,
                        backgroundColor: colors.card,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 10.5,
                          fontWeight: "700",
                          color: copiedId === ex.id ? colors.green : colors.blue,
                        }}
                      >
                        {copiedId === ex.id ? "Copied ✓" : "Copy Prompt"}
                      </Text>
                    </Pressable>
                  </View>
                  <Text style={{ fontSize: 11.5, fontFamily: "monospace", color: colors.muted }}>
                    {ex.prompt}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ))}
    </ScrollView>
  );
}

function ComfyLogDock({
  api,
  viewportWidth,
}: {
  api: ReturnType<typeof useWorkspace>["api"];
  viewportWidth: number;
}) {
  const [open, setOpen] = useState(true);
  const [dockWidth, setDockWidth] = useState(315);
  const draggingRef = useRef(false);
  const maxDockWidth = Math.max(315, Math.floor((viewportWidth - 760) / 2) - 22);
  const effectiveDockWidth = Math.min(dockWidth, maxDockWidth);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(maxDockWidth, Math.max(280, e.clientX - 14));
      setDockWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [maxDockWidth]);
  const [logOpen, setLogOpen] = useState(true);
  const [paused, setPaused] = useState(false);
  const [logLevel, setLogLevel] = useState<"all" | "info" | "warn" | "error">("all");
  const [ctrl, setCtrl] = useState<ComfyControlState>({
    lines: [],
    vramUsedGb: 0,
    vramTotalGb: 0,
    running: 0,
    pending: 0,
  });
  const [storagePath, setStoragePath] = useState("/mnt/a/AI_Models");
  const [sharedPath, setSharedPath] = useState("");
  const [sharedLabel, setSharedLabel] = useState("");
  const [localDefault, setLocalDefault] = useState("");
  const [localLabel, setLocalLabel] = useState("~/ComfyUI/models");
  const [maxSteps, setMaxSteps] = useState(16);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    api
      .request<{
        path?: string;
        sharedPath?: string;
        sharedLabel?: string;
        localDefault?: string;
        localLabel?: string;
      }>("/api/model-storage")
      .then((r) => {
        if (r?.path) setStoragePath(r.path);
        if (r?.sharedPath !== undefined) setSharedPath(r.sharedPath);
        if (r?.sharedLabel !== undefined) setSharedLabel(r.sharedLabel);
        if (r?.localDefault) setLocalDefault(r.localDefault);
        if (r?.localLabel) setLocalLabel(r.localLabel);
      });
    api
      .request<{ maxSteps?: number }>("/api/model-settings")
      .then((r) => {
        if (typeof r?.maxSteps === "number") setMaxSteps(r.maxSteps);
      })
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    if (paused) return;
    let dead = false;
    const load = () =>
      api
        .request<ComfyControlState>("/api/comfy-control")
        .then((r) => {
          if (!dead && r?.lines) setCtrl(r);
        })
        .catch(() => {});
    void load();
    const iv = setInterval(load, 2500);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, [api, paused]);

  const changeMaxSteps = (delta: number) => {
    const next = Math.min(50, Math.max(4, maxSteps + delta));
    setMaxSteps(next);
    void api
      .request<{ maxSteps?: number }>("/api/model-settings", { maxSteps: next })
      .then((r) => {
        if (typeof r?.maxSteps === "number") setMaxSteps(r.maxSteps);
      })
      .catch(() => {});
  };
  const sendAction = (action: "interrupt" | "clear" | "free") => {
    void api.request("/api/comfy-control", { action }).catch(() => {});
  };

  const pickStorage = (nextPath: string) => {
    const clean = nextPath.trim();
    if (!clean) return;
    setStoragePath(clean);
    void api
      .request<{ path?: string }>("/api/model-storage", { path: clean })
      .then((r) => {
        if (r?.path) setStoragePath(r.path);
      })
      .catch(() => {});
  };

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show ComfyUI control panel"
        onPress={() => setOpen(true)}
        style={{
          position: "absolute",
          left: 14,
          top: 16,
          zIndex: 30,
          paddingHorizontal: 10,
          height: 32,
          borderRadius: 16,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: "600", color: colors.text }}>ComfyUI ▸</Text>
      </Pressable>
    );
  }

  const vramPct =
    ctrl.vramTotalGb > 0
      ? Math.min(100, Math.round((ctrl.vramUsedGb / ctrl.vramTotalGb) * 100))
      : 0;
  const barPct = vramPct > 0 ? Math.max(vramPct, 6) : 0;
  const sectionHeaderStyle = { fontSize: 12, fontWeight: "700" as const, color: colors.text };

  return (
    <View
      style={{
        position: "absolute",
        left: 14,
        top: 16,
        bottom: logOpen ? 16 : undefined,
        width: effectiveDockWidth,
        zIndex: 25,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 18,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <Text style={sectionHeaderStyle}>ComfyUI Control</Text>
        <Pressable
          onPress={() => setOpen(false)}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 8,
            backgroundColor: colors.canvas,
          }}
        >
          <Text style={{ fontSize: 10.5, fontWeight: "600", color: colors.muted }}>Hide</Text>
        </Pressable>
      </View>

      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 9,
          gap: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <Text style={sectionHeaderStyle}>
            VRAM {ctrl.vramUsedGb}/{ctrl.vramTotalGb || 24} GB ({vramPct}%)
          </Text>
          <Text style={{ fontSize: 11, color: ctrl.running > 0 ? colors.green : colors.muted }}>
            Run: {ctrl.running} · Q: {ctrl.pending}
          </Text>
        </View>
        <View
          style={{ height: 7, borderRadius: 4, backgroundColor: "#1F2937", overflow: "hidden" }}
        >
          <View
            style={{
              height: "100%",
              width: `${barPct}%`,
              backgroundColor: vramPct > 88 ? "#EF4444" : vramPct > 70 ? "#F59E0B" : "#10B981",
              borderRadius: 4,
            }}
          />
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Pressable
            onPress={() => sendAction("interrupt")}
            style={{
              flex: 1,
              paddingVertical: 5,
              borderRadius: 8,
              backgroundColor: colors.canvas,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.danger }}>
              Stop Render
            </Text>
          </Pressable>
          <Pressable
            onPress={() => sendAction("free")}
            style={{
              flex: 1,
              paddingVertical: 5,
              borderRadius: 8,
              backgroundColor: colors.canvas,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.text }}>Free VRAM</Text>
          </Pressable>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 2,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "600", color: colors.text }}>
            Agent Step Limit
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Pressable
              onPress={() => changeMaxSteps(-2)}
              style={{
                width: 24,
                height: 22,
                borderRadius: 6,
                backgroundColor: colors.canvas,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>−</Text>
            </Pressable>
            <Text
              style={{
                fontSize: 11.5,
                fontWeight: "700",
                color: colors.text,
                minWidth: 22,
                textAlign: "center",
              }}
            >
              {maxSteps}
            </Text>
            <Pressable
              onPress={() => changeMaxSteps(2)}
              style={{
                width: 24,
                height: 22,
                borderRadius: 6,
                backgroundColor: colors.canvas,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ gap: 5, paddingTop: 4 }}>
          <Text style={sectionHeaderStyle} numberOfLines={1}>
            Download & Save Models To:
          </Text>
          <View style={{ flexDirection: "row", gap: 5 }}>
            {sharedPath ? (
              <Pressable
                onPress={() => pickStorage(sharedPath)}
                style={{
                  flex: 1,
                  paddingVertical: 4,
                  borderRadius: 7,
                  backgroundColor: storagePath === sharedPath ? colors.blueDark : colors.canvas,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{ fontSize: 10.5, fontWeight: "600", color: colors.text }}
                  numberOfLines={1}
                >
                  {sharedLabel}
                </Text>
              </Pressable>
            ) : null}
            {localDefault ? (
              <Pressable
                onPress={() => pickStorage(localDefault)}
                style={{
                  flex: 1,
                  paddingVertical: 4,
                  borderRadius: 7,
                  backgroundColor: storagePath === localDefault ? colors.blueDark : colors.canvas,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{ fontSize: 10.5, fontWeight: "600", color: colors.text }}
                  numberOfLines={1}
                >
                  {localLabel}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => {
                const custom =
                  typeof window !== "undefined"
                    ? window.prompt("Model download root path:", storagePath)
                    : null;
                if (custom) pickStorage(custom);
              }}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 5,
                borderRadius: 7,
                backgroundColor:
                  storagePath !== "/mnt/a/AI_Models" && storagePath !== localDefault
                    ? colors.blueDark
                    : colors.canvas,
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 10.5, fontWeight: "600", color: colors.text }}>Custom…</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: logOpen ? 1 : 0,
          borderBottomColor: colors.line,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={logOpen ? "Collapse console log" : "Expand console log"}
          onPress={() => setLogOpen((v) => !v)}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}
        >
          <Text style={sectionHeaderStyle}>Console Log</Text>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted }}>
            {logOpen ? "▾" : "▸"}
          </Text>
        </Pressable>
        {logOpen ? (
          <Pressable
            onPress={() => setPaused((p) => !p)}
            style={{
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: 8,
              backgroundColor: colors.canvas,
            }}
          >
            <Text
              style={{
                fontSize: 10.5,
                fontWeight: "600",
                color: paused ? colors.orange : colors.muted,
              }}
            >
              {paused ? "Resume" : "Pause"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {logOpen ? (
        <>
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderBottomWidth: 1,
              borderBottomColor: colors.line,
              gap: 5,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {(
                [
                  ["all", "All"],
                  ["info", "Info"],
                  ["warn", "Warn"],
                  ["error", "Error"],
                ] as const
              ).map(([lvl, label]) => (
                <Pressable
                  key={lvl}
                  onPress={() => setLogLevel(lvl)}
                  style={{
                    flex: 1,
                    paddingVertical: 3,
                    borderRadius: 6,
                    backgroundColor: logLevel === lvl ? colors.blueDark : colors.canvas,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "700",
                      color: logLevel === lvl ? "#FFFFFF" : colors.text,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingHorizontal: 2,
              }}
            >
              <Text style={{ fontSize: 9.5, fontWeight: "600", color: "#38BDF8" }}>● ComfyUI</Text>
              <Text style={{ fontSize: 9.5, fontWeight: "600", color: "#4ADE80" }}>● LLM</Text>
              <Text style={{ fontSize: 9.5, fontWeight: "600", color: "#C084FC" }}>● Vision</Text>
              <Text style={{ fontSize: 9.5, fontWeight: "600", color: "#E2E8F0" }}>● Studio</Text>
            </View>
          </View>
          <ScrollView
            ref={scrollRef}
            onContentSizeChange={() => {
              if (!paused) scrollRef.current?.scrollToEnd({ animated: false });
            }}
            style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 8 }}
          >
            {ctrl.lines
              .filter((entry) => {
                const isErr = /\berror\b|traceback|exception|\bfailed\b/i.test(entry.text);
                const isWarn = !isErr && /\bwarn(?:ing)?\b|\[warn/i.test(entry.text);
                if (logLevel === "error") return isErr;
                if (logLevel === "warn") return isWarn;
                if (logLevel === "info") return !isErr && !isWarn;
                return true;
              })
              .map((entry) => {
                const t = entry.text;
                const color = /llama|qwen3-8b|qwen3-14b|slot /i.test(t)
                  ? "#4ADE80"
                  : /qwen2\.5-vl|seamlessclone|copy_region/i.test(t)
                    ? "#C084FC"
                    : /openmuse|ffmpeg|tts/i.test(t)
                      ? "#E2E8F0"
                      : "#38BDF8";
                return (
                  <Text
                    key={entry.id}
                    style={{
                      fontSize: 10.5,
                      lineHeight: 15,
                      fontFamily: "monospace",
                      color,
                      marginBottom: 2,
                    }}
                  >
                    {t}
                  </Text>
                );
              })}
          </ScrollView>
        </>
      ) : null}
      <button
        type="button"
        title="Drag to resize panel (double-click to reset)"
        onMouseDown={(e) => {
          e.preventDefault();
          draggingRef.current = true;
        }}
        onDoubleClick={() => setDockWidth(315)}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 10,
          cursor: "ew-resize",
          zIndex: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "transparent",
          borderWidth: 0,
          padding: 0,
          outline: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 12,
            bottom: 12,
            width: 1,
            backgroundColor: "rgba(255,255,255,0.22)",
          }}
        />
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            backgroundColor: "#E2E8F0",
            border: "1.5px solid #0F172A",
            zIndex: 1,
          }}
        />
      </button>
    </View>
  );
}

interface MediaGalleryItem {
  name: string;
  kind: "image" | "video" | "audio";
  sizeKb: number;
  mtimeMs: number;
  url: string;
}
function MediaGalleryDock({
  api,
  viewportWidth,
}: {
  api: ReturnType<typeof useWorkspace>["api"];
  viewportWidth: number;
}) {
  const [open, setOpen] = useState(true);
  const [galleryWidth, setGalleryWidth] = useState(315);
  const draggingRef = useRef(false);
  const maxGalleryWidth = Math.max(315, Math.floor((viewportWidth - 760) / 2) - 22);
  const effectiveGalleryWidth = Math.min(galleryWidth, maxGalleryWidth);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(maxGalleryWidth, Math.max(280, window.innerWidth - e.clientX - 14));
      setGalleryWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [maxGalleryWidth]);
  const [items, setItems] = useState<MediaGalleryItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [copiedName, setCopiedName] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaSrc = (u: string) => (u.startsWith("http") ? u : API_URL + u);
  const refresh = () => {
    api
      .request<{ items?: MediaGalleryItem[] }>("/api/media-gallery")
      .then((r) => {
        if (Array.isArray(r?.items)) setItems(r.items);
      })
      .catch(() => {});
  };
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 8000);
    return () => clearInterval(iv);
  }, [api]);
  const toggleMicRecord = async () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recChunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
        const blob = new Blob(recChunksRef.current, { type: mr.mimeType || "audio/webm" });
        const file = new File([blob], `mic-voice-${Date.now()}.webm`, { type: blob.type });
        const dt = new DataTransfer();
        dt.items.add(file);
        void uploadFiles(dt.files);
      };
      recorderRef.current = mr;
      mr.start();
      setRecSec(0);
      setRecording(true);
      recTimerRef.current = setInterval(() => setRecSec((s) => s + 1), 1000);
    } catch {}
  };
  const uploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const dataBase64 = await new Promise<string>((res, rej) => {
          const rd = new FileReader();
          rd.onload = () => res(typeof rd.result === "string" ? rd.result : "");
          rd.onerror = () => rej(new Error("Read failed"));
          rd.readAsDataURL(file);
        });
        if (!dataBase64) continue;
        const out = await api.request<{ ok?: boolean; name?: string }>("/api/media-upload", {
          name: file.name,
          dataBase64,
        });
        if (out?.name) {
          setCopiedName(out.name);
          if (typeof navigator !== "undefined" && navigator.clipboard)
            void navigator.clipboard.writeText(out.name).catch(() => {});
        }
      }
      refresh();
    } finally {
      setUploading(false);
    }
  };
  if (!open)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show Media Studio panel"
        onPress={() => setOpen(true)}
        style={{
          position: "absolute",
          right: 14,
          top: 16,
          zIndex: 30,
          paddingHorizontal: 10,
          height: 32,
          borderRadius: 16,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: "600", color: colors.text }}>◂ Media</Text>
      </Pressable>
    );
  return (
    <View
      style={{
        position: "absolute",
        right: 14,
        top: 16,
        bottom: 16,
        width: effectiveGalleryWidth,
        zIndex: 25,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 18,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>Media Studio</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Pressable
            onPress={refresh}
            style={{
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: 8,
              backgroundColor: colors.canvas,
            }}
          >
            <Text style={{ fontSize: 10.5, fontWeight: "600", color: colors.muted }}>Refresh</Text>
          </Pressable>
          <Pressable
            onPress={() => setOpen(false)}
            style={{
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: 8,
              backgroundColor: colors.canvas,
            }}
          >
            <Text style={{ fontSize: 10.5, fontWeight: "600", color: colors.muted }}>Hide</Text>
          </Pressable>
        </View>
      </View>
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text, marginBottom: 6 }}>
          Input Dropzone:
        </Text>
        <button
          type="button"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void uploadFiles(e.dataTransfer?.files ?? null);
          }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragOver ? "#10B981" : "#374151"}`,
            borderRadius: 10,
            padding: "11px 10px",
            textAlign: "center",
            backgroundColor: dragOver ? "rgba(16,185,129,0.12)" : "rgba(17,24,39,0.55)",
            cursor: "pointer",
            color: "#E5E7EB",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {uploading ? "Uploading to generated/…" : "Drop images, videos, or audio here"}
          {copiedName ? (
            <div style={{ fontSize: 10, color: "#10B981", marginTop: 4 }}>
              Saved & copied: {copiedName}
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </button>
        <Pressable
          onPress={() => void toggleMicRecord()}
          style={{
            marginTop: 6,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 8,
            backgroundColor: recording ? colors.danger : colors.canvas,
            borderWidth: 1,
            borderColor: recording ? colors.danger : colors.line,
            alignItems: "center",
          }}
        >
          <Text
            style={{ fontSize: 11, fontWeight: "700", color: recording ? "#FFFFFF" : colors.text }}
          >
            {recording ? `■ Stop & Save (${recSec}s)` : "● Record Voice Sample (Mic)"}
          </Text>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>
          Generated & Uploaded ({items.length})
        </Text>
      </View>
      <ScrollView style={{ flex: 1, paddingHorizontal: 10, paddingBottom: 10 }}>
        {items.length === 0 ? (
          <Text style={{ fontSize: 11, color: colors.muted, padding: 8 }}>
            No images or videos in generated/ yet.
          </Text>
        ) : (
          items.map((item) => (
            <View
              key={item.name}
              style={{
                backgroundColor: colors.canvas,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.line,
                padding: 7,
                marginBottom: 8,
                gap: 6,
              }}
            >
              {item.kind === "audio" ? (
                <audio src={mediaSrc(item.url)} controls style={{ width: "100%", height: 36 }}>
                  <track kind="captions" />
                </audio>
              ) : item.kind === "video" ? (
                <video
                  src={mediaSrc(item.url)}
                  controls
                  muted
                  playsInline
                  style={{
                    width: "100%",
                    maxHeight: 155,
                    borderRadius: 7,
                    backgroundColor: "#000",
                  }}
                />
              ) : (
                <img
                  src={mediaSrc(item.url)}
                  alt={item.name}
                  style={{ width: "100%", maxHeight: 165, objectFit: "cover", borderRadius: 7 }}
                />
              )}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                }}
              >
                <Text
                  style={{ flex: 1, fontSize: 10.5, fontWeight: "600", color: colors.text }}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <Pressable
                  onPress={() => {
                    setCopiedName(item.name);
                    if (typeof navigator !== "undefined" && navigator.clipboard)
                      void navigator.clipboard.writeText(item.name).catch(() => {});
                  }}
                  style={{
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                    borderRadius: 6,
                    backgroundColor: colors.card,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "600",
                      color: copiedName === item.name ? colors.green : colors.text,
                    }}
                  >
                    {copiedName === item.name ? "Copied" : "Copy"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (typeof window !== "undefined")
                      window.open(mediaSrc(item.url), "_blank", "noopener,noreferrer");
                  }}
                  style={{
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                    borderRadius: 6,
                    backgroundColor: colors.card,
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: "600", color: colors.text }}>↗</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Delete ${item.name}`}
                  onPress={() => {
                    void fetch(`${API_URL}/api/media-file/${encodeURIComponent(item.name)}`, {
                      method: "DELETE",
                      headers: api.token ? { Authorization: `Bearer ${api.token}` } : {},
                    })
                      .then(() => {
                        setItems((prev) => prev.filter((x) => x.name !== item.name));
                        refresh();
                      })
                      .catch(() => {});
                  }}
                  style={{
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                    borderRadius: 6,
                    backgroundColor: colors.card,
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: "700", color: colors.danger }}>Del</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
      <button
        type="button"
        title="Drag to resize panel (double-click to reset)"
        onMouseDown={(e) => {
          e.preventDefault();
          draggingRef.current = true;
        }}
        onDoubleClick={() => setGalleryWidth(315)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: 10,
          cursor: "ew-resize",
          zIndex: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "transparent",
          borderWidth: 0,
          padding: 0,
          outline: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 12,
            bottom: 12,
            width: 1,
            backgroundColor: "rgba(255,255,255,0.22)",
          }}
        />
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            backgroundColor: "#E2E8F0",
            border: "1.5px solid #0F172A",
            zIndex: 1,
          }}
        />
      </button>
    </View>
  );
}

export default function App() {
  const [token, setToken] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const connect = useCallback(async (key?: string) => {
    setBusy(true);
    setError("");
    try {
      const session = await createSession(key);
      setToken(session.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void connect();
  }, [connect]);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {token ? (
        <CopilotKitProvider
          runtimeUrl={`${API_URL}/api/copilotkit`}
          headers={{ Authorization: `Bearer ${token}` }}
        >
          <WorkspaceApp token={token} />
        </CopilotKitProvider>
      ) : (
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: colors.canvas,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 420, gap: 22, alignItems: "center" }}>
            <Mascot size={72} />
            <Text
              style={{ fontSize: 32, color: colors.text, letterSpacing: -1, fontWeight: "500" }}
            >
              Welcome to OpenMuse.
            </Text>
            <Text style={[s.muted, { textAlign: "center" }]}>A little room for your day.</Text>
            {busy ? (
              <ActivityIndicator color={colors.blueDark} />
            ) : (
              <Card style={{ width: "100%" }}>
                <ErrorNotice error={error} />
                <Field
                  label="Workspace access key"
                  value={accessKey}
                  onChangeText={setAccessKey}
                  secureTextEntry
                  placeholder="Required for a live workspace"
                />
                <Button primary onPress={() => void connect(accessKey || undefined)}>
                  Open workspace
                </Button>
                <Text style={[s.small, { marginTop: 15 }]}>
                  Local workspaces open without a key. Make sure your OpenMuse server is running at{" "}
                  {API_URL}.
                </Text>
              </Card>
            )}
          </View>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}
function WorkspaceApp({ token }: { token: string }) {
  const api = useMemo(() => new MuseApi(token), [token]);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [section, setSection] = useState<Section>("chat");
  const [detail, setDetail] = useState<Detail>();
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  const refresh = useCallback(async () => {
    const snapshot = await api.request<Workspace>("/api/workspace");
    setWorkspace(snapshot);
    setError("");
  }, [api]);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch((e) => setError(String(e)));
    });
    return () => listener.remove();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = useCallback(
    (next: Section) =>
      setSection(next === "today" ? "chat" : next === "connections" ? "apps" : next),
    [],
  );
  const open = useCallback((next: Detail) => setDetail(next), []);
  const close = useCallback(() => setDetail(undefined), []);
  const ask = useCallback((text: string) => {
    setPrompt({ id: Date.now(), text });
    setSection("chat");
  }, []);
  if (!workspace)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 18,
        }}
      >
        <Mascot size={56} />
        {error ? (
          <>
            <ErrorNotice error={error} />
            <Button onPress={() => void refresh().catch((e) => setError(String(e)))}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.blueDark} />
            <Text style={s.muted}>Opening your workspace…</Text>
          </>
        )}
      </SafeAreaView>
    );
  return (
    <WorkspaceContext.Provider
      value={{ workspace, api, section, navigate, refresh, open, close, notify: setToast, ask }}
    >
      <AgentWorkspaceProvider>
        <ComputerDraftProvider key={token}>
          <ThreadsProvider>
            <WorkspaceShell
              detail={detail}
              toast={toast}
              clearToast={() => setToast("")}
              error={error}
              prompt={prompt}
            />
          </ThreadsProvider>
        </ComputerDraftProvider>
      </AgentWorkspaceProvider>
    </WorkspaceContext.Provider>
  );
}
function WorkspaceShell({
  detail,
  toast,
  clearToast,
  error,
  prompt,
}: {
  detail?: Detail;
  toast: string;
  clearToast: () => void;
  error: string;
  prompt?: { id: number; text: string };
}) {
  useThemeMode();
  const { api, workspace, section, navigate, open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const {
    selection,
    visited,
    mainId,
    loading: threadsLoading,
    error: threadsError,
    retry: retryThreads,
    enabled: richThreads,
  } = useMuseThread();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [videoSettingsOpen, setVideoSettingsOpen] = useState(false);
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);
  const [modelMode, setModelMode] = useState<"cloud" | "q4" | "q5">("cloud");
  const [modelBusy, setModelBusy] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  useEffect(() => {
    void api
      .request<{ mode?: "cloud" | "q4" | "q5" }>("/api/model-settings")
      .then((data) => {
        if (data?.mode === "cloud" || data?.mode === "q4" || data?.mode === "q5") {
          setModelMode(data.mode);
        }
      })
      .catch(() => {});
  }, [api]);
  async function selectModelMode(next: "cloud" | "q4" | "q5") {
    setModelMenuOpen(false);
    if (modelBusy || next === modelMode) return;
    setModelBusy(true);
    try {
      const saved = await api.request<{ mode?: "cloud" | "q4" | "q5" }>("/api/model-settings", {
        mode: next,
      });
      if (saved?.mode === "cloud" || saved?.mode === "q4" || saved?.mode === "q5") {
        setModelMode(saved.mode);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not switch model");
    } finally {
      setModelBusy(false);
    }
  }
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const pending =
    (data?.notifications.filter((n) => !n.read).length || 0) +
    workspace.actions.filter((a) => a.status === "awaiting_review").length;
  const activeTask =
    data?.tasks.find(
      (task) => task.status === "waiting_approval" || task.status === "waiting_input",
    ) || data?.tasks.find((task) => task.status === "running");
  const agentName = data?.identity.name || "OpenMuse";
  const status = activeTask
    ? activeTask.status === "waiting_approval"
      ? `Ready to review · ${activeTask.title}`
      : activeTask.status === "waiting_input"
        ? `Needs your input · ${activeTask.title}`
        : activeTask.plan.find((step) => step.status === "running")?.title || activeTask.title
    : data?.tasks.some((task) => task.status === "queued")
      ? "Picking up your next task…"
      : "Here when you need me";
  const title = titles[section] || titles.apps;
  const Screen =
    section === "mail"
      ? MailScreen
      : section === "calendar"
        ? CalendarScreen
        : section === "browser"
          ? BrowserScreen
          : section === "files"
            ? FilesScreen
            : section === "activity"
              ? AgentActivityScreen
              : section === "ideas"
                ? IdeasScreen
                : section === "goals"
                  ? GoalsScreen
                  : section === "help"
                    ? HelpScreen
                    : AppsScreen;
  const utility = ["mail", "calendar", "browser", "files"].includes(section);
  return (
    <>
      <WorkspaceTools />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["top", "bottom"]}>
        {width >= 1180 && (
          <>
            <ComfyLogDock api={api} viewportWidth={width} />
            <MediaGalleryDock api={api} viewportWidth={width} />
          </>
        )}
        <View style={{ flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" }}>
          <View
            style={{
              height: desktop ? 146 : 122,
              paddingTop: desktop ? 14 : 2,
              marginHorizontal: 20,
            }}
          >
            <View style={{ position: "absolute", left: 0, top: 16, zIndex: 10 }}>
              <IconButton
                icon={Menu}
                label="Open conversations and menu"
                onPress={() => setThreadsOpen(true)}
              />
            </View>
            <View
              style={{
                position: "absolute",
                left: "25%",
                top: 19,
                transform: [{ translateX: -46 }],
                zIndex: 10,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Select active AI model"
                onPress={() => setModelMenuOpen((v) => !v)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 10,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: modelMode !== "cloud" ? colors.blueDark : colors.line,
                }}
              >
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor:
                      modelMode === "q5"
                        ? "#10B981"
                        : modelMode === "q4"
                          ? colors.blueDark
                          : colors.muted,
                  }}
                />
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.text }}>
                  {modelBusy
                    ? "Switching…"
                    : modelMode === "q4"
                      ? "Qwen3 8B"
                      : modelMode === "q5"
                        ? "Qwen3 14B"
                        : "Gemini"}
                </Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>
                  {modelMenuOpen ? "▲" : "▼"}
                </Text>
              </Pressable>

              {modelMenuOpen && (
                <View
                  style={{
                    position: "absolute",
                    top: 38,
                    left: 0,
                    minWidth: 165,
                    backgroundColor: colors.card,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.line,
                    paddingVertical: 4,
                    zIndex: 50,
                    shadowColor: "#000",
                    shadowOpacity: 0.25,
                    shadowRadius: 8,
                    elevation: 6,
                  }}
                >
                  {(
                    [
                      { id: "cloud", label: "Gemini", dot: colors.muted },
                      { id: "q4", label: "Qwen3 8B", dot: colors.blueDark },
                      { id: "q5", label: "Qwen3 14B", dot: "#10B981" },
                    ] as const
                  ).map((opt) => (
                    <Pressable
                      key={opt.id}
                      onPress={() => void selectModelMode(opt.id)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 9,
                        backgroundColor: opt.id === modelMode ? colors.canvas : "transparent",
                      }}
                    >
                      <View
                        style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: opt.dot }}
                      />
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: opt.id === modelMode ? "700" : "500",
                          color: colors.text,
                        }}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
            <View
              style={{ position: "absolute", left: "50%", marginLeft: 134, top: 17, zIndex: 10 }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open ComfyUI in new tab"
                onPress={() => {
                  const u = ["http://", "localhost", ":", "8188"].join("");
                  if (typeof document !== "undefined") {
                    const a = document.createElement("a");
                    a.href = u;
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                    a.referrerPolicy = "no-referrer";
                    a.click();
                  }
                }}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 11,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.line,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={
                    {
                      fontSize: 12,
                      fontWeight: "600",
                      color: colors.text,
                      whiteSpace: "nowrap",
                    } as never
                  }
                >
                  ComfyUI ↗
                </Text>
              </Pressable>
            </View>
            <View pointerEvents="box-none" style={{ alignItems: "center", gap: 1 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Customize ${agentName} avatar`}
                onPress={() => setAvatarSheetOpen(true)}
                style={({ pressed }) => ({
                  alignItems: "center",
                  maxWidth: "70%",
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <Mascot size={desktop ? 58 : 49} variant={data?.identity.avatar} />
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "600",
                    color: colors.text,
                    letterSpacing: -0.4,
                  }}
                >
                  {agentName}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}
                >
                  {status}
                </Text>
              </Pressable>
              {section === "chat" && <ComputerEntry />}
            </View>
            <View style={{ position: "absolute", right: 0, top: 16 }}>
              <IconButton
                icon={Bell}
                label={`Notifications, ${pending} unread or pending`}
                onPress={() => open({ type: "notifications" })}
              />
              {pending > 0 && (
                <View
                  pointerEvents="none"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 4,
                    position: "absolute",
                    top: 7,
                    right: 9,
                    backgroundColor: colors.blueDark,
                  }}
                />
              )}
            </View>
          </View>
          <View style={{ flex: 1, minHeight: 0 }}>
            {section !== "chat" && (
              <ScrollView
                key={section}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: desktop ? 42 : 22, paddingBottom: 28 }}
                keyboardShouldPersistTaps="handled"
              >
                {utility && (
                  <Button
                    small
                    style={{ alignSelf: "flex-start", marginBottom: 18 }}
                    onPress={() => navigate("apps")}
                  >
                    Back to Apps
                  </Button>
                )}
                <Text style={[s.title, { fontSize: 25, marginBottom: 22 }]}>{title?.title}</Text>
                <ErrorNotice error={error} />
                <Screen />
              </ScrollView>
            )}
            <View
              style={{
                display: section === "chat" ? "flex" : "none",
                flex: 1,
                paddingHorizontal: desktop ? 42 : 17,
              }}
            >
              <AgentStatus />
              {richThreads ? (
                <>
                  <ErrorNotice error={threadsError} />
                  {threadsError ? (
                    <Button onPress={retryThreads}>Retry main chat</Button>
                  ) : threadsLoading ? (
                    <ActivityIndicator color={colors.blueDark} />
                  ) : null}
                  {!threadsLoading && selection.id !== mainId && (
                    <Text style={[s.small, { textAlign: "center", marginBottom: 8 }]}>
                      Side chat
                    </Text>
                  )}
                  {visited.map((thread) => (
                    <View
                      key={thread.id}
                      style={{ display: selection.id === thread.id ? "flex" : "none", flex: 1 }}
                    >
                      <ChatScreen
                        thread={thread}
                        active={section === "chat" && selection.id === thread.id}
                        prompt={selection.id === thread.id ? prompt : undefined}
                      />
                    </View>
                  ))}
                </>
              ) : (
                <ChatScreen prompt={prompt} active={section === "chat"} />
              )}
            </View>
          </View>
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 10,
              paddingBottom: desktop ? 22 : 7,
              alignItems: "center",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                width: "100%",
                maxWidth: 370,
                padding: 5,
                backgroundColor: colors.card,
                borderRadius: 40,
                shadowColor: "#132631",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.07,
                shadowRadius: 18,
                elevation: 3,
                borderWidth: 1,
                borderColor: colors.line,
              }}
            >
              {nav.map((item) => {
                const active = section === item.id || (item.id === "apps" && utility);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="tab"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: active }}
                    onPress={() => navigate(item.id)}
                    style={{
                      flex: 1,
                      height: 47,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: active ? colors.line : "transparent",
                      borderRadius: 28,
                    }}
                  >
                    <item.icon size={23} strokeWidth={1.8} color={colors.text} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
        {!!toast && (
          <View
            pointerEvents="box-none"
            style={{ position: "absolute", bottom: 94, left: 20, right: 20, alignItems: "center" }}
          >
            <View
              style={[
                s.row,
                {
                  gap: 10,
                  padding: 14,
                  backgroundColor: colors.text,
                  borderRadius: 20,
                  maxWidth: 560,
                },
              ]}
            >
              <Check size={16} color={colors.blue} />
              <Text style={{ color: "#FFF", fontSize: 13, flexShrink: 1 }}>{toast}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss notification"
                onPress={clearToast}
              >
                <X size={16} color="#FFF" />
              </Pressable>
            </View>
          </View>
        )}
        {threadsOpen && (
          <ThreadsSheet
            onClose={() => setThreadsOpen(false)}
            onOpenVideoStudio={() => setVideoSettingsOpen(true)}
          />
        )}
        {videoSettingsOpen && <VideoSettingsModal onClose={() => setVideoSettingsOpen(false)} />}
        {avatarSheetOpen && (
          <Sheet
            title="Agent Avatar"
            subtitle="Change avatar on the fly"
            onClose={() => setAvatarSheetOpen(false)}
          >
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.heading}>Upload or pick any image</Text>
                  <Text style={s.muted}>
                    Updates immediately across the header and chat without restarting.
                  </Text>
                </View>
              </View>
              <label
                style={{
                  display: "block",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px dashed #374151",
                  textAlign: "center",
                  cursor: "pointer",
                  color: "#E5E7EB",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Choose Image File (.png / .jpg / .webp)…
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const rd = new FileReader();
                    rd.onload = () => {
                      const dataBase64 = typeof rd.result === "string" ? rd.result : "";
                      if (!dataBase64) return;
                      void api
                        .request<{ ok?: boolean; ts?: number }>("/api/avatar", { dataBase64 })
                        .then((r) => {
                          if (r?.ok) {
                            notifyAvatarUpdated(r.ts || Date.now());
                            setAvatarSheetOpen(false);
                          }
                        })
                        .catch(() => {});
                    };
                    rd.readAsDataURL(file);
                  }}
                />
              </label>
              <Pressable
                onPress={() => {
                  void api
                    .request<{ ok?: boolean; ts?: number }>("/api/avatar", { reset: true })
                    .then((r) => {
                      if (r?.ok) {
                        notifyAvatarUpdated(r.ts || Date.now());
                        setAvatarSheetOpen(false);
                      }
                    })
                    .catch(() => {});
                }}
                style={{
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: colors.canvas,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>
                  Reset to Default Avatar
                </Text>
              </Pressable>
            </Card>
          </Sheet>
        )}
        {detail && (
          <Details
            key={
              detail.type === "task"
                ? detail.taskId
                : detail.type === "file"
                  ? detail.file.id
                  : detail.type === "browser"
                    ? detail.browser.id
                    : detail.type === "mail"
                      ? detail.mail.id
                      : detail.type === "review"
                        ? detail.action.id
                        : detail.type === "email"
                          ? JSON.stringify(detail.draft)
                          : detail.type === "event"
                            ? detail.event?.id || "event-new"
                            : detail.type
            }
            detail={detail}
          />
        )}
      </SafeAreaView>
    </>
  );
}
