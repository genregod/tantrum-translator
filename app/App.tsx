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
// Tantrum Translator v2.0 — Voice Edition
// 🎤 Record → 📝 Whisper transcribe → 🔄 Translate → 🔊 Speak
// ═══════════════════════════════════════════════════

const SCREEN_WIDTH = Dimensions.get('window').width;

type Phase = 'idle' | 'recording' | 'transcribing' | 'done' | 'error';

type Session = {
  id: number;
  transcription: string;
  translation: string;
  timestamp: number;
};

// Tantrum → English translation patterns
const TANTRUM_TO_ENGLISH: Array<[RegExp, string]> = [
  [/no{2,}/gi, 'I feel strongly about this and would like to be heard.'],
  [/i don'?t wanna/gi, 'I need help with this but do not know how to ask.'],
  [/mine+/gi, 'I feel a need for ownership and control right now.'],
  [/now+/gi, 'I am struggling with patience and waiting.'],
  [/hungry+/gi, 'I might be hungry — a snack could help.'],
  [/tired+/gi, 'I am feeling sleepy and overwhelmed.'],
  [/more+/gi, 'I would like some more, please.'],
  [/no no+/gi, 'I am expressing discomfort with this situation.'],
  [/don'?t make me/gi, 'I feel pressured and need a sense of autonomy.'],
  [/five more/gi, 'I need a few more minutes to transition.'],
  [/i hate/gi, 'I am experiencing strong emotions I cannot fully express.'],
  [/mean+/gi, 'I feel this is unfair to me.'],
  [/i don'?t know/gi, 'I am feeling overwhelmed by too many choices.'],
  [/yuck/gi, 'I do not like the look or smell of this.'],
  [/gross/gi, 'This does not appeal to me at all.'],
  [/nooo/gi, 'I am feeling frustrated and need comfort.'],
  [/stop+/gi, 'I am feeling overstimulated and need a break.'],
  [/waa+/gi, 'I need attention and comfort right now.'],
  [/why+/gi, 'I am curious but also feeling uncertain.'],
];

// English → Tantrum translation patterns
const ENGLISH_TO_TANTRUM: Array<[RegExp, string]> = [
  [/\bno\b/gi, 'NOOOOO!!!'],
  [/\bwon'?t\b/gi, "I DON'T WANNA!!!"],
  [/\bdon'?t\b/gi, "YOU CAN'T MAKE ME!!!"],
  [/\bstop\b/gi, 'NO NO NO NO NO!!!'],
  [/\bwait\b/gi, 'NOOOOWWW!!! I WANT IT NOOOWWW!!!'],
  [/\blater\b/gi, 'BUT I WANT IT NOOOOWWW!!!'],
  [/\bbedtime\b/gi, "I'M NOT TIIIIIRED!!!"],
  [/\bsleep\b/gi, "I'M NOT TIIIIIRED!!!"],
  [/\bno more\b/gi, 'BUT I NEEEED IIIIT!!!'],
  [/\benough\b/gi, 'BUT I WANT MOOOORE!!!'],
  [/\bshare\b/gi, "MIIIINE!!! IT'S MIIIINE!!!"],
  [/\bdinner\b/gi, "I DON'T LIKE IIIIT!!!"],
  [/\bschool\b/gi, "I DON'T WANNA GO TO SCHOOOOL!!!"],
  [/\bbath\b/gi, 'NOOOO!!! NOT THE BAAATH!!!'],
  [/\bhomework\b/gi, "IT'S DUUUUMB!!! I HATE IT!!!"],
];

function translateText(text: string, mode: 'tantrum2english' | 'english2tantrum'): string {
  const patterns = mode === 'tantrum2english' ? TANTRUM_TO_ENGLISH : ENGLISH_TO_TANTRUM;

  for (const [pattern, replacement] of patterns) {
    if (pattern.test(text)) {
      if (mode === 'english2tantrum') {
        return text.replace(pattern, replacement).toUpperCase() + '!!!';
      }
      return replacement;
    }
  }

  // Fallback
  if (mode === 'tantrum2english') {
    return "I'm expressing a need I can't articulate yet. I might be tired, hungry, or overwhelmed.";
  }
  return 'BUT WHYYYYY?!? NOOOOO!!!';
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

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Load saved API key ───
  // Key priority: AsyncStorage (user override) > EAS secret (built-in) > empty
  const builtInKey = Constants.expoConfig?.extra?.openaiApiKey || '';

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem('openai_api_key');
      if (saved) {
        setApiKey(saved);
      } else if (builtInKey) {
        setApiKey(builtInKey);
      }
    })();
  }, []);

  // ─── Cleanup on unmount ───
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync();
      }
      Speech.stop();
    };
  }, []);

  // ─── Start recording ───
  const startRecording = async () => {
    try {
      setErrorMsg('');

      // Request permissions
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Needed', 'Microphone access is required to listen to tantrums.');
        return;
      }

      // Configure audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      // Start recording
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
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      });

      await recording.startAsync();
      recordingRef.current = recording;
      setPhase('recording');
      setRecordSecs(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordSecs((s) => s + 1);
      }, 1000);

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err: any) {
      setErrorMsg(`Recording error: ${err.message}`);
      setPhase('error');
    }
  };

  // ─── Stop recording & transcribe ───
  const stopAndTranscribe = async () => {
    try {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      if (!recordingRef.current) return;

      setPhase('transcribing');
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) {
        setErrorMsg('No audio file was created.');
        setPhase('error');
        return;
      }

      // Check if API key exists
      if (!apiKey) {
        setShowSettings(true);
        setErrorMsg('Please enter your OpenAI API key in Settings to use speech recognition.');
        setPhase('error');
        return;
      }

      // Read audio file as base64
      const fileBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Clean up the temp file
      FileSystem.deleteAsync(uri).catch(() => {});

      // Send to OpenAI Whisper API
      const formData = new FormData();
      formData.append('file', {
        uri: `data:audio/m4a;base64,${fileBase64}`,
        type: 'audio/m4a',
        name: 'recording.m4a',
      } as any);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        setErrorMsg(`Whisper API error (${resp.status}): ${errBody}`);
        setPhase('error');
        return;
      }

      const data = await resp.json();
      const transcribed = (data.text || '').trim();

      if (!transcribed) {
        setErrorMsg('No speech detected. Try again!');
        setPhase('error');
        return;
      }

      // Translate
      const translated = translateText(transcribed, 'tantrum2english');

      setTranscription(transcribed);
      setTranslation(translated);
      setPhase('done');

      // Save to session history
      setSessions([
        { id: Date.now(), transcription: transcribed, translation: translated, timestamp: Date.now() },
        ...sessions,
      ].slice(0, 10));

      // Speak the translation
      speakText(translated);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setErrorMsg(`Transcription error: ${err.message}`);
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

  const stopSpeaking = () => {
    Speech.stop();
    setIsSpeaking(false);
  };

  // ─── Save API key ───
  const saveApiKey = async () => {
    await AsyncStorage.setItem('openai_api_key', apiKey);
    setShowSettings(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // ─── Format time ───
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
        <Text style={styles.headerSubtitle}>Voice Edition · v2.0</Text>
      </View>

      {/* ─── Settings Button ─── */}
      <TouchableOpacity style={styles.settingsButton} onPress={() => setShowSettings(true)}>
        <Text style={styles.settingsIcon}>⚙️</Text>
        <Text style={styles.settingsLabel}>
          {apiKey ? 'API Key ✓' : 'Set API Key'}
        </Text>
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
                  <View style={styles.recordingDot} />
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
            ) : (
              <TouchableOpacity
                style={[styles.micButton, styles.micButtonDone]}
                onPress={() => setPhase('idle')}
              >
                <View style={styles.micButtonInner}>
                  <Text style={styles.micEmoji}>✅</Text>
                  <Text style={styles.micButtonText}>Done! Tap to record again</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* ─── Error Display ─── */}
          {errorMsg && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
            </View>
          )}

          {/* ─── Result Display ─── */}
          {(phase === 'done' || phase === 'transcribing') && transcription && (
            <View style={styles.resultSection}>
              {/* What was heard */}
              <View style={styles.resultCard}>
                <View style={styles.resultCardHeader}>
                  <Text style={styles.resultCardLabel}>📝 Heard</Text>
                </View>
                <Text style={styles.transcriptionText}>{transcription}</Text>
              </View>

              {/* Arrow */}
              <Text style={styles.resultArrow}>↓</Text>

              {/* Translation */}
              <View style={[styles.resultCard, styles.translationCard]}>
                <View style={styles.resultCardHeader}>
                  <Text style={styles.resultCardLabel}>💬 Translation</Text>
                  <TouchableOpacity
                    style={styles.speakButton}
                    onPress={isSpeaking ? stopSpeaking : () => speakText(translation)}
                  >
                    <Text style={styles.speakButtonText}>
                      {isSpeaking ? '🔇 Stop' : '🔊 Speak'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.translationText}>{translation}</Text>
              </View>
            </View>
          )}

          {/* ─── Session History ─── */}
          {sessions.length > 0 && (
            <View style={styles.historySection}>
              <Text style={styles.historyTitle}>Recent Translations</Text>
              {sessions.map((s) => (
                <View key={s.id} style={styles.historyCard}>
                  <Text style={styles.historyTime}>{formatTimestamp(s.timestamp)}</Text>
                  <Text style={styles.historyTranscription}>"{s.transcription}"</Text>
                  <Text style={styles.historyArrow}>→</Text>
                  <Text style={styles.historyTranslation}>{s.translation}</Text>
                  <TouchableOpacity
                    style={styles.historySpeakBtn}
                    onPress={isSpeaking ? stopSpeaking : () => speakText(s.translation)}
                  >
                    <Text style={styles.historySpeakText}>🔊 Play</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* ─── Quick Text Input (optional) ─── */}
          <View style={styles.textSection}>
            <Text style={styles.textSectionTitle}>Or type instead:</Text>
            <QuickTranslate onResult={(input, output) => {
              setTranscription(input);
              setTranslation(output);
              setPhase('done');
              speakText(output);
            }} />
          </View>
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
                : 'Enter your OpenAI API key to enable Whisper speech recognition.\n\nGet one at: platform.openai.com/api-keys\nYour key is stored locally on this device only.'}
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
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setShowSettings(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={saveApiKey}
              >
                <Text style={styles.modalButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Quick Text Translate Component ───
function QuickTranslate({
  onResult,
}: {
  onResult: (input: string, output: string) => void;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'tantrum2english' | 'english2tantrum'>('tantrum2english');

  const handleTranslate = () => {
    if (!text.trim()) return;
    const output = translateText(text, mode);
    onResult(text, output);
    setText('');
  };

  return (
    <View style={styles.quickTranslate}>
      <View style={styles.modeSwitcher}>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'tantrum2english' && styles.modeButtonActive]}
          onPress={() => setMode('tantrum2english')}
        >
          <Text style={[styles.modeButtonText, mode === 'tantrum2english' && styles.modeButtonTextActive]}>
            😤 → 👨
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'english2tantrum' && styles.modeButtonActive]}
          onPress={() => setMode('english2tantrum')}
        >
          <Text style={[styles.modeButtonText, mode === 'english2tantrum' && styles.modeButtonTextActive]}>
            👨 → 😤
          </Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.textInput}
        placeholder={mode === 'tantrum2english' ? 'Type the tantrum...' : 'Type to tantrum-ify...'}
        placeholderTextColor="#999"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={200}
      />
      <TouchableOpacity style={styles.translateButton} onPress={handleTranslate}>
        <Text style={styles.translateButtonText}>Translate! 🎉</Text>
      </TouchableOpacity>
    </View>
  );
}

// ═══════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FF6B6B',
  },
  flex: { flex: 1 },
  header: {
    alignItems: 'center',
    paddingTop: 15,
    paddingBottom: 10,
    paddingHorizontal: 20,
  },
  headerEmoji: {
    fontSize: 32,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 4,
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  settingsButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    zIndex: 10,
  },
  settingsIcon: {
    fontSize: 16,
    marginRight: 4,
  },
  settingsLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  // ─── Mic Section ───
  micSection: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  micButton: {
    width: SCREEN_WIDTH * 0.7,
    height: SCREEN_WIDTH * 0.7,
    borderRadius: (SCREEN_WIDTH * 0.7) / 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  micButtonRecording: {
    backgroundColor: 'rgba(255,50,50,0.3)',
    borderColor: '#ff4444',
  },
  micButtonProcessing: {
    backgroundColor: 'rgba(255,200,50,0.2)',
    borderColor: '#ffc832',
  },
  micButtonDone: {
    backgroundColor: 'rgba(78,205,196,0.2)',
    borderColor: '#4ECDC4',
  },
  micButtonInner: {
    alignItems: 'center',
  },
  micEmoji: {
    fontSize: 48,
  },
  micButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 8,
  },
  micButtonSubtext: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 4,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ff4444',
    position: 'absolute',
    top: -20,
    alignSelf: 'center',
  },
  // ─── Error ───
  errorCard: {
    backgroundColor: 'rgba(255,200,50,0.9)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: '#333',
    fontSize: 14,
    fontWeight: '500',
  },
  // ─── Results ───
  resultSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  translationCard: {
    borderWidth: 2,
    borderColor: '#4ECDC4',
  },
  resultCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  resultCardLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FF6B6B',
  },
  resultArrow: {
    fontSize: 28,
    color: 'rgba(255,255,255,0.5)',
    marginVertical: 8,
  },
  transcriptionText: {
    fontSize: 16,
    color: '#666',
    fontStyle: 'italic',
    lineHeight: 22,
  },
  translationText: {
    fontSize: 18,
    color: '#333',
    fontWeight: '600',
    lineHeight: 26,
  },
  speakButton: {
    backgroundColor: '#4ECDC4',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  speakButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  // ─── History ───
  historySection: {
    marginBottom: 20,
  },
  historyTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  historyCard: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  historyTime: {
    fontSize: 11,
    color: '#999',
    marginBottom: 6,
  },
  historyTranscription: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  historyArrow: {
    fontSize: 14,
    color: '#ccc',
    marginBottom: 4,
  },
  historyTranslation: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
    marginBottom: 8,
  },
  historySpeakBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#FF6B6B',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  historySpeakText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  // ─── Quick Text ───
  textSection: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    paddingTop: 20,
  },
  textSectionTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginBottom: 10,
  },
  quickTranslate: {},
  modeSwitcher: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },
  modeButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  modeButtonActive: {
    backgroundColor: '#fff',
    borderColor: '#FF6B6B',
  },
  modeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modeButtonTextActive: {
    color: '#FF6B6B',
  },
  textInput: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    minHeight: 60,
    maxHeight: 100,
    marginBottom: 10,
  },
  translateButton: {
    backgroundColor: '#4ECDC4',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  translateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // ─── Modal ───
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  modalDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 22,
    marginBottom: 16,
  },
  apiKeyInput: {
    borderWidth: 2,
    borderColor: '#FF6B6B',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#f0f0f0',
  },
  modalButtonSave: {
    backgroundColor: '#FF6B6B',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
});
