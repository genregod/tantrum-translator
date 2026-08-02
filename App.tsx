import React, { useState, useRef, useEffect } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ═══════════════════════════════════════════════════
// Tantrum Translator v2.1 — GPT-Powered Translation
// 🎤 Record → 📝 Whisper transcribe → 🤖 GPT translate → 🔊 Speak
// ═══════════════════════════════════════════════════

const SCREEN_WIDTH = Dimensions.get('window').width;

type Phase = 'idle' | 'recording' | 'transcribing' | 'translating' | 'done' | 'error';

type Session = {
  id: number;
  transcription: string;
  translation: string;
  persona: string;
  timestamp: number;
};

// ═══ Personas (from v1 — Anthony's original concept) ═══
const PERSONAS = [
  {
    key: 'butler',
    label: 'The Butler',
    emoji: '🎩',
    blurb: 'A long-suffering English butler.',
    systemPrompt: 'You are a long-suffering English butler named James. A toddler in the household is having a tantrum. You will translate the transcribed tantrum into what the child is actually trying to communicate, speaking as the butler would — dry, formal, faintly exasperated but deeply devoted. One to three sentences. Be specific about what the child needs.',
  },
  {
    key: 'barrister',
    label: 'The Barrister',
    emoji: '⚖️',
    blurb: "A King's Counsel before the court.",
    systemPrompt: 'You are a King\'s Counsel barrister presenting a case. A toddler\'s tantrum has been transcribed as evidence. Translate what the child is actually trying to communicate, presenting it as a formal legal argument before the court. One to three sentences. Be specific about the child\'s grievance and what they demand.',
  },
  {
    key: 'narrator',
    label: 'The Narrator',
    emoji: '📻',
    blurb: 'A hushed wildlife narrator.',
    systemPrompt: 'You are a hushed wildlife documentary narrator observing a small human creature in the wild. The creature\'s tantrum has been transcribed. Translate what the child is actually trying to communicate, narrating it in the style of David Attenborough. One to three sentences. Be specific about what the creature needs.',
  },
  {
    key: 'diplomat',
    label: 'The Diplomat',
    emoji: '🌐',
    blurb: 'A UN envoy issuing a communiqué.',
    systemPrompt: 'You are a UN diplomat issuing an official communiqué. A toddler\'s tantrum has been transcribed. Translate what the child is actually trying to communicate, framing it as diplomatic statements about the crisis. One to three sentences. Be specific about the child\'s demands and grievances.',
  },
  {
    key: 'duchess',
    label: 'The Duchess',
    emoji: '👑',
    blurb: 'An imperious, unimpressed aristocrat.',
    systemPrompt: 'You are an imperious duchess who finds the whole thing rather beneath her. A toddler\'s tantrum has been transcribed. Translate what the child is actually trying to communicate, commenting on it with aristocratic disdain but genuine insight. One to three sentences. Be specific about what the child wants.',
  },
  {
    key: 'plain',
    label: 'Plain English',
    emoji: '💬',
    blurb: 'Just tell it like it is.',
    systemPrompt: 'You are a child development expert and empathetic parent. A toddler\'s tantrum has been transcribed. Translate what the child is actually trying to communicate in plain, warm, direct English. One to three sentences. Be specific and practical about what the child needs right now.',
  },
];

// ═══ Fallback patterns (used if GPT API fails) ═══
const FALLBACK_PATTERNS: Array<[RegExp, string]> = [
  [/no{2,}/gi, 'I feel strongly about this and need to be heard.'],
  [/i don'?t wanna/gi, 'I need help with this but do not know how to ask.'],
  [/mine+/gi, 'I feel a need for ownership and control right now.'],
  [/now+/gi, 'I am struggling with patience and waiting.'],
  [/hungry+/gi, 'I might be hungry, a snack could help.'],
  [/tired+/gi, 'I am feeling sleepy and overwhelmed.'],
  [/more+/gi, 'I would like some more, please.'],
  [/stop+/gi, 'I am feeling overstimulated and need a break.'],
];

function fallbackTranslate(text: string): string {
  for (const [pattern, replacement] of FALLBACK_PATTERNS) {
    if (pattern.test(text)) return replacement;
  }
  return 'I am overwhelmed and need comfort. Try asking me what is wrong.';
}

// ═══ GPT Translation via OpenAI Chat Completions ═══
async function gptTranslate(
  transcription: string,
  personaSystemPrompt: string,
  apiKey: string
): Promise<string> {
  const userPrompt = transcription.trim()
    ? `The tantrum was transcribed as: "${transcription}"\n\nTranslate what this child is actually trying to communicate.`
    : 'The child was screaming or crying but no words were clearly transcribed. Based on the sounds, translate what they might be trying to communicate.';

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: personaSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 150,
      temperature: 0.8,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`GPT API error (${resp.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await resp.json();
  const translation = data.choices?.[0]?.message?.content?.trim();
  if (!translation) throw new Error('GPT returned empty translation');
  return translation;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [transcription, setTranscription] = useState('');
  const [translation, setTranslation] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [persona, setPersona] = useState('butler');

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const builtInKey = Constants.expoConfig?.extra?.openaiApiKey || '';
  const currentPersona = PERSONAS.find((p) => p.key === persona) || PERSONAS[0];

  // ─── Load saved API key + persona ───
  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem('openai_api_key');
      if (saved) setApiKey(saved);
      else if (builtInKey) setApiKey(builtInKey);
      const savedPersona = await AsyncStorage.getItem('persona');
      if (savedPersona) setPersona(savedPersona);
    })();
  }, []);

  // ─── Cleanup on unmount ───
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingRef.current) recordingRef.current.stopAndUnloadAsync();
      Speech.stop();
    };
  }, []);

  // ─── Start recording ───
  const startRecording = async () => {
    try {
      setErrorMsg('');
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Needed', 'Microphone access is required to listen to tantrums.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
      });

      await recording.startAsync();
      recordingRef.current = recording;
      setPhase('recording');
      setRecordSecs(0);
      timerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err: any) {
      setErrorMsg(`Recording error: ${err.message}`);
      setPhase('error');
    }
  };

  // ─── Stop recording, transcribe via Whisper, translate via GPT ───
  const stopAndTranscribe = async () => {
    try {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (!recordingRef.current) return;

      setPhase('transcribing');
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) { setErrorMsg('No audio file was created.'); setPhase('error'); return; }

      if (!apiKey) {
        setShowSettings(true);
        setErrorMsg('Please enter your OpenAI API key in Settings.');
        setPhase('error');
        return;
      }

      // ── Step 1: Whisper transcription ──
      const fileBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      FileSystem.deleteAsync(uri).catch(() => {});

      const formData = new FormData();
      formData.append('file', {
        uri: `data:audio/m4a;base64,${fileBase64}`,
        type: 'audio/m4a',
        name: 'recording.m4a',
      } as any);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!whisperResp.ok) {
        const errBody = await whisperResp.text();
        setErrorMsg(`Whisper error (${whisperResp.status}): ${errBody.slice(0, 200)}`);
        setPhase('error');
        return;
      }

      const whisperData = await whisperResp.json();
      const transcribed = (whisperData.text || '').trim();

      // ── Step 2: GPT translation ──
      setPhase('translating');

      let translated: string;
      try {
        translated = await gptTranslate(transcribed, currentPersona.systemPrompt, apiKey);
      } catch (gptErr) {
        // Fallback to pattern matching if GPT fails
        console.warn('GPT translation failed, using fallback:', gptErr);
        translated = fallbackTranslate(transcribed);
      }

      setTranscription(transcribed || '(no clear words detected)');
      setTranslation(translated);
      setPhase('done');

      setSessions([
        { id: Date.now(), transcription: transcribed, translation: translated, persona: currentPersona.label, timestamp: Date.now() },
        ...sessions,
      ].slice(0, 10));

      // ── Step 3: Speak the translation ──
      speakText(translated);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setErrorMsg(`Error: ${err.message}`);
      setPhase('error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  // ─── Text-to-speech ───
  const speakText = (text: string) => {
    Speech.stop();
    setIsSpeaking(true);
    Speech.speak(text, {
      language: 'en-US',
      pitch: 1.0,
      rate: 0.95,
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  };

  const stopSpeaking = () => { Speech.stop(); setIsSpeaking(false); };

  // ─── Save API key ───
  const saveApiKey = async () => {
    await AsyncStorage.setItem('openai_api_key', apiKey);
    setShowSettings(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // ─── Change persona ───
  const changePersona = async (key: string) => {
    setPersona(key);
    await AsyncStorage.setItem('persona', key);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // ─── Helpers ───
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ExpoStatusBar style="light" />

      {/* ─── Header ─── */}
      <View style={styles.header}>
        <Text style={styles.headerEmoji}>😤👶</Text>
        <Text style={styles.headerTitle}>Tantrum Translator</Text>
        <Text style={styles.headerSubtitle}>Voice Edition · v2.1</Text>
      </View>

      {/* ─── Settings Button ─── */}
      <TouchableOpacity style={styles.settingsButton} onPress={() => setShowSettings(true)}>
        <Text style={styles.settingsIcon}>⚙️</Text>
        <Text style={styles.settingsLabel}>{apiKey ? 'API Key ✓' : 'Set API Key'}</Text>
      </TouchableOpacity>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* ─── Persona Selector ─── */}
          <View style={styles.personaSection}>
            <Text style={styles.personaLabel}>CHOOSE YOUR INTERPRETER</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.personaScroll}>
              {PERSONAS.map((p) => {
                const active = p.key === persona;
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[styles.personaChip, active && styles.personaChipActive]}
                    onPress={() => changePersona(p.key)}
                  >
                    <Text style={styles.personaEmoji}>{p.emoji}</Text>
                    <Text style={[styles.personaChipText, active && styles.personaChipTextActive]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.personaBlurb}>{currentPersona.blurb}</Text>
          </View>

          {/* ─── Mic Button ─── */}
          <View style={styles.micSection}>
            {phase === 'idle' || phase === 'error' ? (
              <TouchableOpacity style={styles.micButton} onPress={startRecording}>
                <View style={styles.micButtonInner}>
                  <Text style={styles.micEmoji}>🎤</Text>
                  <Text style={styles.micButtonText}>Tap to Listen</Text>
                  <Text style={styles.micButtonSubtext}>Hold near the tantrum</Text>
                </View>
              </TouchableOpacity>
            ) : phase === 'recording' ? (
              <TouchableOpacity style={[styles.micButton, styles.micButtonRecording]} onPress={stopAndTranscribe}>
                <View style={styles.micButtonInner}>
                  <Text style={styles.micEmoji}>🔴</Text>
                  <Text style={styles.micButtonText}>Recording...</Text>
                  <Text style={styles.micButtonText}>{formatTime(recordSecs)}</Text>
                  <Text style={styles.micButtonSubtext}>Tap to stop & translate</Text>
                </View>
              </TouchableOpacity>
            ) : phase === 'transcribing' ? (
              <View style={[styles.micButton, styles.micButtonProcessing]}>
                <View style={styles.micButtonInner}>
                  <ActivityIndicator size="large" color="#fff" />
                  <Text style={styles.micButtonText}>Transcribing...</Text>
                  <Text style={styles.micButtonSubtext}>Sending to Whisper AI</Text>
                </View>
              </View>
            ) : phase === 'translating' ? (
              <View style={[styles.micButton, styles.micButtonProcessing]}>
                <View style={styles.micButtonInner}>
                  <ActivityIndicator size="large" color="#fff" />
                  <Text style={styles.micButtonText}>Translating...</Text>
                  <Text style={styles.micButtonSubtext}>{currentPersona.emoji} {currentPersona.label} is interpreting</Text>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={[styles.micButton, styles.micButtonDone]} onPress={() => setPhase('idle')}>
                <View style={styles.micButtonInner}>
                  <Text style={styles.micEmoji}>✅</Text>
                  <Text style={styles.micButtonText}>Done! Tap to record again</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* ─── Error Display ─── */}
          {errorMsg ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
            </View>
          ) : null}

          {/* ─── Result Display ─── */}
          {(phase === 'done' || phase === 'translating') && transcription ? (
            <View style={styles.resultSection}>
              <View style={styles.resultCard}>
                <View style={styles.resultCardHeader}>
                  <Text style={styles.resultCardLabel}>📝 Heard</Text>
                </View>
                <Text style={styles.transcriptionText}>{transcription}</Text>
              </View>
              <Text style={styles.resultArrow}>↓</Text>
              <View style={[styles.resultCard, styles.translationCard]}>
                <View style={styles.resultCardHeader}>
                  <Text style={styles.resultCardLabel}>
                    {currentPersona.emoji} {currentPersona.label}
                  </Text>
                  <TouchableOpacity style={styles.speakButton} onPress={isSpeaking ? stopSpeaking : () => speakText(translation)}>
                    <Text style={styles.speakButtonText}>{isSpeaking ? '🔇 Stop' : '🔊 Speak'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.translationText}>{translation}</Text>
              </View>
            </View>
          ) : null}

          {/* ─── Session History ─── */}
          {sessions.length > 0 ? (
            <View style={styles.historySection}>
              <Text style={styles.historyTitle}>Recent Translations</Text>
              {sessions.map((s) => (
                <View key={s.id} style={styles.historyCard}>
                  <Text style={styles.historyPersona}>{s.persona}</Text>
                  <Text style={styles.historyTime}>{formatTimestamp(s.timestamp)}</Text>
                  <Text style={styles.historyTranscription}>"{s.transcription}"</Text>
                  <Text style={styles.historyArrow}>→</Text>
                  <Text style={styles.historyTranslation}>{s.translation}</Text>
                  <TouchableOpacity style={styles.historySpeakBtn} onPress={isSpeaking ? stopSpeaking : () => speakText(s.translation)}>
                    <Text style={styles.historySpeakText}>🔊 Play</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ─── Settings Modal ─── */}
      <Modal visible={showSettings} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>⚙️ OpenAI API Key</Text>
            <Text style={styles.modalDescription}>
              {builtInKey
                ? 'API key is built into this build via EAS secrets.\nYou can override it with a different key below.'
                : 'Enter your OpenAI API key to enable speech recognition.\n\nGet one at: platform.openai.com/api-keys\nYour key is stored locally on this device only.'}
            </Text>
            <TextInput
              style={styles.apiKeyInput}
              placeholder="sk-..."
              placeholderTextColor="#999"
              value={apiKey}
              onChangeText={setApiKey}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} onPress={() => setShowSettings(false)}>
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonSave]} onPress={saveApiKey}>
                <Text style={styles.modalButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FF6B6B' },
  flex: { flex: 1 },
  header: { alignItems: 'center', paddingTop: 15, paddingBottom: 8, paddingHorizontal: 20 },
  headerEmoji: { fontSize: 32 },
  headerTitle: { fontSize: 26, fontWeight: 'bold', color: '#fff', marginTop: 4 },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  settingsButton: {
    position: 'absolute', top: 50, right: 20, flexDirection: 'row',
    alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, zIndex: 10,
  },
  settingsIcon: { fontSize: 16, marginRight: 4 },
  settingsLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: 20, paddingBottom: 40 },
  // ─── Persona Section ───
  personaSection: { marginBottom: 16 },
  personaLabel: {
    fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1.5, marginBottom: 10,
  },
  personaScroll: { flexDirection: 'row', marginBottom: 8 },
  personaChip: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2, borderColor: 'transparent', marginRight: 8,
  },
  personaChipActive: { backgroundColor: '#fff', borderColor: '#FF6B6B' },
  personaEmoji: { fontSize: 16, marginRight: 6 },
  personaChipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  personaChipTextActive: { color: '#FF6B6B' },
  personaBlurb: {
    color: 'rgba(255,255,255,0.5)', fontSize: 12, fontStyle: 'italic',
  },
  // ─── Mic Section ───
  micSection: { alignItems: 'center', paddingVertical: 16 },
  micButton: {
    width: SCREEN_WIDTH * 0.65, height: SCREEN_WIDTH * 0.65,
    borderRadius: (SCREEN_WIDTH * 0.65) / 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)',
  },
  micButtonRecording: { backgroundColor: 'rgba(255,50,50,0.3)', borderColor: '#ff4444' },
  micButtonProcessing: { backgroundColor: 'rgba(255,200,50,0.2)', borderColor: '#ffc832' },
  micButtonDone: { backgroundColor: 'rgba(78,205,196,0.2)', borderColor: '#4ECDC4' },
  micButtonInner: { alignItems: 'center' },
  micEmoji: { fontSize: 48 },
  micButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginTop: 8 },
  micButtonSubtext: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 4 },
  // ─── Error ───
  errorCard: { backgroundColor: 'rgba(255,200,50,0.9)', borderRadius: 12, padding: 14, marginBottom: 16 },
  errorText: { color: '#333', fontSize: 14, fontWeight: '500' },
  // ─── Results ───
  resultSection: { alignItems: 'center', marginBottom: 20 },
  resultCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, width: '100%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  translationCard: { borderWidth: 2, borderColor: '#4ECDC4' },
  resultCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  resultCardLabel: { fontSize: 14, fontWeight: 'bold', color: '#FF6B6B' },
  resultArrow: { fontSize: 28, color: 'rgba(255,255,255,0.5)', marginVertical: 8 },
  transcriptionText: { fontSize: 16, color: '#666', fontStyle: 'italic', lineHeight: 22 },
  translationText: { fontSize: 18, color: '#333', fontWeight: '600', lineHeight: 26 },
  speakButton: { backgroundColor: '#4ECDC4', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  speakButtonText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  // ─── History ───
  historySection: { marginBottom: 20 },
  historyTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  historyCard: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 14, padding: 14, marginBottom: 10 },
  historyPersona: { color: '#FF6B6B', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  historyTime: { fontSize: 11, color: '#999', marginBottom: 6 },
  historyTranscription: { fontSize: 14, color: '#666', fontStyle: 'italic', marginBottom: 4 },
  historyArrow: { fontSize: 14, color: '#ccc', marginBottom: 4 },
  historyTranslation: { fontSize: 15, color: '#333', fontWeight: '500', marginBottom: 8, lineHeight: 22 },
  historySpeakBtn: { alignSelf: 'flex-start', backgroundColor: '#FF6B6B', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  historySpeakText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  // ─── Modal ───
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%' },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  modalDescription: { fontSize: 14, color: '#666', lineHeight: 22, marginBottom: 16 },
  apiKeyInput: { borderWidth: 2, borderColor: '#FF6B6B', borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 16 },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalButton: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalButtonCancel: { backgroundColor: '#f0f0f0' },
  modalButtonSave: { backgroundColor: '#FF6B6B' },
  modalButtonText: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
});
