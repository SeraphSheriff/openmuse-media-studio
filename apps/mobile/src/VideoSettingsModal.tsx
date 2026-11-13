import { Film, RotateCcw, Save, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { Button, colors, s } from "./ui";
import { useWorkspace } from "./workspace";

type FieldDef =
  | { key: string; label: string; hint?: string; kind: "bool" }
  | { key: string; label: string; hint?: string; kind: "number"; min?: number; max?: number }
  | { key: string; label: string; hint?: string; kind: "text"; multiline?: boolean; presets?: string[] }
  | { key: string; label: string; hint?: string; kind: "choice"; options: Array<{ value: string; label: string }> };

type StudioPayload = { settings: Record<string, string | number | boolean>; schema: Array<{ section: string; fields: FieldDef[] }> };

export function VideoSettingsModal({ onClose }: { onClose: () => void }) {
  const { api, notify } = useWorkspace();
  const [data, setData] = useState<StudioPayload | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.request<StudioPayload>("/api/video-settings").then(setData);
  }, [api]);

  const setVal = (key: string, val: string | number | boolean) =>
    setData((prev) => (prev ? { ...prev, settings: { ...prev.settings, [key]: val } } : prev));

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      setData(await api.request<StudioPayload>("/api/video-settings", data.settings));
      notify("Video Studio settings saved.");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      setData(await api.request<StudioPayload>("/api/video-settings/reset", {}));
      notify("Reset to recommended RTX 3090 defaults.");
    } finally {
      setSaving(false);
    }
  };

  const renderField = (f: FieldDef) => {
    const val = data!.settings[f.key];
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
                <Pressable key={opt.value} onPress={() => setVal(f.key, opt.value)} style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 14, backgroundColor: active ? "#1D4ED8" : "#27272A", borderWidth: 1, borderColor: active ? "#3B82F6" : "#3F3F46" }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: "#FAFAFA" }}>{opt.label}</Text>
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
            value={String(val ?? "")}
            onChangeText={(t) => { const n = Number(t); if (!Number.isNaN(n)) setVal(f.key, n); }}
            keyboardType="numeric"
            style={{ backgroundColor: "#18181B", color: "#FAFAFA", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, borderWidth: 1, borderColor: "#3F3F46" }}
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
              <Pressable key={p || "none"} onPress={() => setVal(f.key, p)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: String(val) === p ? "#1D4ED8" : "#27272A" }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: "#FAFAFA" }}>{p || "None"}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <TextInput
          value={String(val ?? "")}
          onChangeText={(t) => setVal(f.key, t)}
          multiline={f.multiline}
          style={{ backgroundColor: "#18181B", color: "#FAFAFA", borderRadius: 10, padding: 10, fontSize: 13, minHeight: f.multiline ? 52 : undefined, borderWidth: 1, borderColor: "#3F3F46" }}
        />
      </View>
    );
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.68)", justifyContent: "center", alignItems: "center", padding: 16 }}>
        <View style={{ width: "100%", maxWidth: 680, maxHeight: "90%", backgroundColor: "#1C1C1F", borderRadius: 24, padding: 20, borderWidth: 1, borderColor: "#2E2E32" }}>
          <View style={[s.row, { justifyContent: "space-between", marginBottom: 14 }]}>
            <View style={[s.row, { gap: 9 }]}>
              <Film size={20} color="#60A5FA" />
              <Text style={{ fontSize: 18, fontWeight: "700", color: "#FAFAFA" }}>Video Studio · LTX-2.3 Settings</Text>
            </View>
            <Pressable onPress={onClose} style={{ padding: 6, backgroundColor: "#27272A", borderRadius: 16 }}>
              <X size={18} color="#E4E4E7" />
            </Pressable>
          </View>
          {!data ? <ActivityIndicator color="#60A5FA" style={{ marginVertical: 40 }} /> : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 14 }}>
              {data.schema.map((sec) => (
                <View key={sec.section} style={{ gap: 10, padding: 14, backgroundColor: "#242428", borderRadius: 16 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#FAFAFA" }}>{sec.section}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    {sec.fields.map((f) => (
                      <View key={f.key} style={{ width: f.kind === "number" ? "48%" : "100%", flexGrow: 1 }}>{renderField(f)}</View>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
          <View style={[s.row, { justifyContent: "space-between", marginTop: 12 }]}>
            <Button small onPress={() => void reset()} disabled={saving}>
              <View style={[s.row, { gap: 5 }]}><RotateCcw size={14} color={colors.text} /><Text style={{ fontSize: 12, fontWeight: "600", color: colors.text }}>Reset Defaults</Text></View>
            </Button>
            <Button primary onPress={() => void save()} disabled={saving || !data}>
              <View style={[s.row, { gap: 6 }]}><Save size={15} color="#FFF" /><Text style={{ fontSize: 13, fontWeight: "600", color: "#FFF" }}>{saving ? "Saving..." : "Save Studio Settings"}</Text></View>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
