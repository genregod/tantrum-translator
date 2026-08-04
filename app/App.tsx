import React, { useState, useRef, useEffect, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
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
  Share,
  Appearance,
  LogBox,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Constants from 'expo-constants';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Suppress LogBox warnings for production
LogBox.ignoreLogs(['Setting a timer', 'AsyncStorage has been extracted']);

// ═══════════════════════════════════════════════════
// Tantrum Translator v3.0 — Premium Android Edition
// 🎤 Record → 📝 Whisper transcribe → 🤖 GPT translate → 🔊 Speak
// Premium: Unlimited translations, exclusive personas, cloud sync, no ads
// ═══════════════════════════════════════════════════

const SCREEN_WIDTH = Dimensions.get('window').width;
const colorScheme = Appearance.getColorScheme();

type Phase = 'idle' | 'recording' | 'transcribing' | 'translating' | 'done' | 'error';

type Session = {
  id: number;
  transcription: string;
  translation: string;
  persona: string;
  timestamp: number;
};

type AnalyticsEvent = {
  event: string;
  timestamp: number;
  data?: Record<string, any>;
};

// ═══ Error Boundary ═══
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.errorBoundaryContainer}>
          <Text style={styles.errorBoundaryEmoji}>😵</Text>
          <Text style={styles.errorBoundaryTitle}>Oops! Something went wrong</Text>
          <Text style={styles.errorBoundaryText}>
            The app encountered an unexpected error. Your data is safe.
          </Text>
          <TouchableOpacity
            style={styles.errorBoundaryButton}
            onPress={() => {
              this.setState({ hasError: false, error: null });
            }}
          >
            <Text style={styles.errorBoundaryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// ═══ Personas (free + premium) ═══
const PERSONAS = [
  {
    key: 'butler',
    label: 'The Butler',
    emoji: '🎩',
    blurb: 'A long-suffering English butler.',
    premium: false,
    systemPrompt: 'You are a long-suffering English butler named James. A toddler in the household is having a tantrum. You will translate the transcribed tantrum into what the child is actually trying to communicate, speaking as the butler would — dry, formal, faintly exasperated but deeply devoted. One to three sentences. Be specific about what the child needs.',
  },
  {
    key: 'barrister',
    label: 'The Barrister',
    emoji: '⚖️',
    blurb: "A King's Counsel before the court.",
    premium: false,
    systemPrompt: 'You are a King\'s Counsel barrister presenting a case. A toddler\'s tantrum has been transcribed as evidence. Translate what the child is actually trying to communicate, presenting it as a formal legal argument before the court. One to three sentences. Be specific about the child\'s grievance and what they demand.',
  },
  {
    key: 'narrator',
    label: 'The Narrator',
    emoji: '📻',
    blurb: 'A hushed wildlife narrator.',
    premium: false,
    systemPrompt: 'You are a hushed wildlife documentary narrator observing a small human creature in the wild. The creature\'s tantrum has been transcribed. Translate what the child is actually trying to communicate, narrating it in the style of David Attenborough. One to three sentences. Be specific about what the creature needs.',
  },
  {
    key: 'diplomat',
    label: 'The Diplomat',
    emoji: '🌐',
    blurb: 'A UN envoy issuing a communiqué.',
    premium: true,
    systemPrompt: 'You are a UN diplomat issuing an official communiqué. A toddler\'s tantrum has been transcribed. Translate what the child is actually trying to communicate, framing it as diplomatic statements about the crisis. One to three sentences. Be specific about the child\'s demands and grievances.',
  },
  {
    key: 'duchess',
    label: 'The Duchess',
    emoji: '👑',
    blurb: 'An imperious, unimpressed aristocrat.',
    premium: true,
    systemPrompt: 'You are an imperious duchess who finds the whole thing rather beneath her. A toddler\'s tantrum has been transcribed. Translate what the child is actually trying to communicate, commenting on it with aristocratic disdain but genuine insight. One to three sentences. Be specific about what the child wants.',
  },
  {
    key: 'plain',
    label: 'Plain English',
    emoji: '💬',
    blurb: 'Just tell it like it is.',
    premium: false,
    systemPrompt: 'You are a child development expert and empathetic parent. A toddler\'s tantrum has been transcribed. Translate what the child is actually trying to communicate in plain, warm, direct English. One to three sentences. Be specific and practical about what the child needs right now.',
  },
  {
    key: 'pirate',
    label: 'The Pirate',
    emoji: '🏴‍☠️',
    blurb: 'A swashbuckling buccaneer.',
    premium: true,
    systemPrompt: 'You are a grizzled pirate captain. A toddler\'s tantrum has been transcribed. Translate what the child is actually trying to communicate, speaking as a pirate would — with nautical metaphors and gruff affection. One to three sentences. Be specific about what the little scallywag needs.',
  },
  {
    key: 'therapist',
    label: 'The Therapist',
    emoji: '🛋️',
    blurb: 'A gentle child psychologist.',
    premium: true,
    systemPrompt: 'You are a gentle, experienced child psychologist. A toddler\'s tantrum has been transcribed. Translate what the child is actually trying to communicate with warm clinical insight, naming the emotion and the underlying need. One to three sentences. Be specific and nurturing.',
  },
  {
    key: 'shakespeare',
    label: 'The Bard',
    emoji: '🎭',
    blurb: 'Shakespeare himself, dramatizing the scene.',
    premium: true,
    systemPrompt: 'You are William Shakespeare. A toddler\'s tantrum has been transcribed. Translate what the child is actually trying to communicate, rendered in iambic pentameter or Elizabethan prose. One to three sentences. Be specific about the child\'s tragic plight.',
  },
];

// ═══ Premium Feature Constants ═══
const FREE_TRANSLATION_LIMIT = 5;
const PREMIUM_SKU = 'com.genregod.tantrumtranslator.premium';
const PREMIUM_LIFETIME_SKU = 'com.genregod.tantrumtranslator.premium_lifetime';

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

// ═══ Analytics ═══
async function trackEvent(event: string, data?: Record<string, any>) {
  try {
    const events = JSON.parse((await AsyncStorage.getItem('analytics_events')) || '[]');
    const newEvent: AnalyticsEvent = { event, timestamp: Date.now(), data };
    events.push(newEvent);
    // Keep only last 200 events
    const trimmed = events.slice(-200);
    await AsyncStorage.setItem('analytics_events', JSON.stringify(trimmed));
    console.log(`📊 Analytics: ${event}`, data || '');
  } catch (e) {
    // Silent fail — analytics should never crash the app
  }
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

// ═══ Onboarding Component ═══
function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      emoji: '🎤',
      title: 'Record the Tantrum',
      text: 'Tap the big mic button and hold your phone near the tantrum. The app will capture the audio automatically.',
    },
    {
      emoji: '🤖',
      title: 'AI Translates It',
      text: 'Whisper AI transcribes the screaming, then GPT translates it into what your child is actually trying to say — through hilarious personas.',
    },
    {
      emoji: '🔊',
      title: 'Hear the Translation',
      text: 'The app speaks the translation out loud. Share it with family, save it to history, and laugh through the chaos.',
    },
    {
      emoji: '✨',
      title: 'Go Premium',
      text: 'Unlock all 9 personas, unlimited translations, cloud sync, and an ad-free experience. Support indie development!',
    },
  ];

  const current = steps[step];

  return (
    <SafeAreaView style={styles.onboardingContainer}>
      <ExpoStatusBar style="light" />
      <View style={styles.onboardingSkip}>
        <TouchableOpacity onPress={() => { onDone(); trackEvent('onboarding_skipped'); }}>
          <Text style={styles.onboardingSkipText}>Skip</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.onboardingContent}>
        <Text style={styles.onboardingEmoji}>{current.emoji}</Text>
        <Text style={styles.onboardingTitle}>{current.title}</Text>
        <Text style={styles.onboardingText}>{current.text}</Text>
      </View>
      <View style={styles.onboardingDots}>
        {steps.map((_, i) => (
          <View
            key={i}
            style={[styles.onboardingDot, i === step && styles.onboardingDotActive]}
          />
        ))}
      </View>
      <TouchableOpacity
        style={styles.onboardingButton}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (step < steps.length - 1) {
            setStep(step + 1);
          } else {
            trackEvent('onboarding_completed');
            onDone();
          }
        }}
      >
        <Text style={styles.onboardingButtonText}>
          {step < steps.length - 1 ? 'Next' : 'Get Started 🎉'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ═══ Premium Paywall Component ═══
function PaywallScreen({
  visible,
  onClose,
  onPurchase,
  purchasing,
}: {
  visible: boolean;
  onClose: () => void;
  onPurchase: (sku: string) => void;
  purchasing: boolean;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View style={styles.paywallOverlay}>
        <View style={styles.paywallContent}>
          <TouchableOpacity style={styles.paywallClose} onPress={onClose}>
            <Text style={styles.paywallCloseText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.paywallEmoji}>✨</Text>
          <Text style={styles.paywallTitle}>Tantrum Translator Premium</Text>
          <Text style={styles.paywallSubtitle}>Unlock the full experience</Text>

          <View style={styles.paywallFeatures}>
            <View style={styles.paywallFeature}>
              <Text style={styles.paywallFeatureIcon}>🎭</Text>
              <Text style={styles.paywallFeatureText}>All 9 personas (Pirate, Therapist, Shakespeare & more)</Text>
            </View>
            <View style={styles.paywallFeature}>
              <Text style={styles.paywallFeatureIcon}>∞</Text>
              <Text style={styles.paywallFeatureText}>Unlimited translations — no daily limits</Text>
            </View>
            <View style={styles.paywallFeature}>
              <Text style={styles.paywallFeatureIcon}>☁️</Text>
              <Text style={styles.paywallFeatureText}>Cloud sync across devices</Text>
            </View>
            <View style={styles.paywallFeature}>
              <Text style={styles.paywallFeatureIcon}>📤</Text>
              <Text style={styles.paywallFeatureText}>Share translations to social media</Text>
            </View>
            <View style={styles.paywallFeature}>
              <Text style={styles.paywallFeatureIcon}>🚫</Text>
              <Text style={styles.paywallFeatureText}>Zero ads, ever</Text>
            </View>
            <View style={styles.paywallFeature}>
              <Text style={styles.paywallFeatureIcon}>🎨</Text>
              <Text style={styles.paywallFeatureText}>Dark mode & Material You theming</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.paywallButton}
            onPress={() => onPurchase(PREMIUM_SKU)}
            disabled={purchasing}
          >
            {purchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.paywallButtonText}>Premium — $2.99/month</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.paywallButtonLifetime}
            onPress={() => onPurchase(PREMIUM_LIFETIME_SKU)}
            disabled={purchasing}
          >
            <Text style={styles.paywallButtonTextLifetime}>Lifetime — $9.99 (Best Value)</Text>
          </TouchableOpacity>
          <Text style={styles.paywallRestore}>Restore purchases in Settings</Text>
        </View>
      </View>
    </Modal>
  );
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [transcription, setTranscription] = useState('');
  const [translation, setTranslation] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [persona, setPersona] = useState('butler');
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [translationCount, setTranslationCount] = useState(0);
  const [purchasing, setPurchasing] = useState(false);
  const [darkMode, setDarkMode] = useState(colorScheme === 'dark');
  const [maxRecordingSecs, setMaxRecordingSecs] = useState(30);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const builtInKey = Constants.expoConfig?.extra?.openaiApiKey || '';
  const currentPersona = PERSONAS.find((p) => p.key === persona) || PERSONAS[0];
  const freePersonaKeys = PERSONAS.filter((p) => !p.premium).map((p) => p.key);
  const translationsRemaining = isPremium
    ? Infinity
    : Math.max(0, FREE_TRANSLATION_LIMIT - translationCount);
  const isAtFreeLimit = !isPremium && translationCount >= FREE_TRANSLATION_LIMIT;

  // Theme colors
  const theme = darkMode
    ? { bg: '#121212', card: '#1E1E1E', text: '#E0E0E0', subtext: '#999', accent: '#BB86FC' }
    : { bg: '#FF6B6B', card: '#fff', text: '#333', subtext: '#666', accent: '#FF6B6B' };

  // ─── Load saved state on mount ───
  useEffect(() => {
    (async () => {
      // Onboarding
      const onboarded = await AsyncStorage.getItem('has_onboarded');
      if (onboarded === 'true') setHasOnboarded(true);

      // API key
      const saved = await AsyncStorage.getItem('openai_api_key');
      if (saved) setApiKey(saved);
      else if (builtInKey) setApiKey(builtInKey);

      // Persona
      const savedPersona = await AsyncStorage.getItem('persona');
      if (savedPersona) setPersona(savedPersona);

      // Premium status
      const premium = await AsyncStorage.getItem('is_premium');
      if (premium === 'true') {
        setIsPremium(true);
        trackEvent('app_open', { premium: true });
      } else {
        trackEvent('app_open', { premium: false });
      }

      // Translation count (daily, resets after 24h)
      const countData = await AsyncStorage.getItem('translation_count');
      const countTime = await AsyncStorage.getItem('translation_count_time');
      if (countData && countTime) {
        const elapsed = Date.now() - parseInt(countTime, 10);
        if (elapsed < 24 * 60 * 60 * 1000) {
          setTranslationCount(parseInt(countData, 10));
        } else {
          // Reset daily count
          await AsyncStorage.setItem('translation_count', '0');
          await AsyncStorage.setItem('translation_count_time', Date.now().toString());
          setTranslationCount(0);
        }
      }

      // Dark mode
      const savedDark = await AsyncStorage.getItem('dark_mode');
      if (savedDark !== null) setDarkMode(savedDark === 'true');

      // Session history
      const savedSessions = await AsyncStorage.getItem('sessions');
      if (savedSessions) {
        try {
          setSessions(JSON.parse(savedSessions).slice(0, 10));
        } catch {}
      }
    })();
  }, []);

  // ─── Listen for appearance changes (Material You) ───
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme: newScheme }) => {
      const savedDark = AsyncStorage.getItem('dark_mode');
      if (savedDark === null && newScheme) {
        setDarkMode(newScheme === 'dark');
      }
    });
    return () => subscription.remove();
  }, []);

  // ─── Save sessions ───
  useEffect(() => {
    if (sessions.length > 0) {
      AsyncStorage.setItem('sessions', JSON.stringify(sessions)).catch(() => {});
    }
  }, [sessions]);

  // ─── Cleanup on unmount ───
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingRef.current) recordingRef.current.stopAndUnloadAsync().catch(() => {});
      Speech.stop();
    };
  }, []);

  // ─── Complete onboarding ───
  const completeOnboarding = async () => {
    await AsyncStorage.setItem('has_onboarded', 'true');
    setHasOnboarded(true);
  };

  // ─── Toggle dark mode ───
  const toggleDarkMode = async () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    await AsyncStorage.setItem('dark_mode', newMode.toString());
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // ─── Simulate IAP purchase (placeholder for expo-in-app-purchases) ───
  const purchasePremium = async (sku: string) => {
    setPurchasing(true);
    try {
      // TODO: Replace with actual IAP integration when building for production
      // import * as InAppPurchases from 'expo-in-app-purchases';
      // const { responseCode, results } = await InAppPurchases.purchaseItemAsync(sku);
      // if (responseCode === InAppPurchases.IAPResponseCode.OK) { ... }

      // For now, simulate successful purchase
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await AsyncStorage.setItem('is_premium', 'true');
      setIsPremium(true);
      setShowPaywall(false);
      trackEvent('premium_purchased', { sku });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('🎉 Premium Unlocked!', 'Enjoy all personas, unlimited translations, and more!');
    } catch (err: any) {
      Alert.alert('Purchase Failed', err.message || 'Something went wrong. Try again.');
      trackEvent('premium_purchase_failed', { error: err.message });
    } finally {
      setPurchasing(false);
    }
  };

  // ─── Restore purchases ───
  const restorePurchases = async () => {
    try {
      // TODO: Replace with actual IAP restore
      // const { responseCode, results } = await InAppPurchases.getPurchaseHistoryAsync();
      trackEvent('restore_purchases');
      Alert.alert('Restore', 'No previous purchases found. If you believe this is an error, contact support.');
    } catch (err: any) {
      Alert.alert('Error', 'Could not restore purchases.');
    }
  };

  // ─── Start recording ───
  const startRecording = async () => {
    // Check free tier limit
    if (isAtFreeLimit) {
      setShowPaywall(true);
      trackEvent('free_limit_hit');
      return;
    }

    try {
      setErrorMsg('');
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Needed', 'Microphone access is required to listen to tantrums.');
        return;
      }

      // Android-optimized audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        // Android-specific: stay active during recording
        staysActiveInBackground: false,
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

      // Auto-stop after maxRecordingSecs (configurable for premium)
      const maxSecs = isPremium ? 60 : 30;
      setMaxRecordingSecs(maxSecs);

      timerRef.current = setInterval(() => {
        setRecordSecs((s) => {
          if (s + 1 >= maxSecs) {
            // Auto-stop at limit
            stopAndTranscribe();
          }
          return s + 1;
        });
      }, 1000);

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      trackEvent('recording_started', { premium: isPremium });
    } catch (err: any) {
      setErrorMsg(`Recording error: ${err.message}`);
      setPhase('error');
      trackEvent('recording_error', { error: err.message });
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
      // Clean up audio file immediately to save RAM (Android optimization)
      FileSystem.deleteAsync(uri).catch(() => {});

      const formData = new FormData();
      formData.append('file', {
        uri: `data:audio/m4a;base64,${fileBase64}`,
        type: 'audio/m4a',
        name: 'recording.m4a',
      } as any);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      trackEvent('whisper_request');

      const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!whisperResp.ok) {
        const errBody = await whisperResp.text();
        setErrorMsg(`Whisper error (${whisperResp.status}): ${errBody.slice(0, 200)}`);
        setPhase('error');
        trackEvent('whisper_error', { status: whisperResp.status });
        return;
      }

      const whisperData = await whisperResp.json();
      const transcribed = (whisperData.text || '').trim();

      // ── Step 2: GPT translation ──
      setPhase('translating');

      let translated: string;
      try {
        translated = await gptTranslate(transcribed, currentPersona.systemPrompt, apiKey);
        trackEvent('gpt_translation_success');
      } catch (gptErr) {
        // Fallback to pattern matching if GPT fails
        console.warn('GPT translation failed, using fallback:', gptErr);
        translated = fallbackTranslate(transcribed);
        trackEvent('gpt_fallback_used', { error: gptErr instanceof Error ? gptErr.message : String(gptErr) });
      }

      setTranscription(transcribed || '(no clear words detected)');
      setTranslation(translated);
      setPhase('done');

      // Increment translation count for free tier
      if (!isPremium) {
        const newCount = translationCount + 1;
        setTranslationCount(newCount);
        await AsyncStorage.setItem('translation_count', newCount.toString());
        await AsyncStorage.setItem('translation_count_time', Date.now().toString());
      }

      const newSession: Session = {
        id: Date.now(),
        transcription: transcribed,
        translation: translated,
        persona: currentPersona.label,
        timestamp: Date.now(),
      };
      const updatedSessions = [newSession, ...sessions].slice(0, 10);
      setSessions(updatedSessions);

      // ── Step 3: Speak the translation ──
      speakText(translated);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      trackEvent('translation_complete', { persona: currentPersona.key, premium: isPremium });
    } catch (err: any) {
      setErrorMsg(`Error: ${err.message}`);
      setPhase('error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      trackEvent('translation_error', { error: err.message });
    }
  };

  // ─── Text-to-speech ───
  const speakText = (text: string) => {
    Speech.stop();
    setIsSpeaking(true);

    // Android-specific TTS optimization
    const speechOptions: Speech.SpeechOptions = {
      language: 'en-US',
      pitch: 1.0,
      rate: Platform.OS === 'android' ? 0.9 : 0.95, // Slightly slower on Android for clarity
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    };

    Speech.speak(text, speechOptions);
  };

  const stopSpeaking = () => { Speech.stop(); setIsSpeaking(false); };

  // ─── Share translation ───
  const shareTranslation = async (trans: string, personaLabel: string) => {
    try {
      const shareText = `😤👶 Tantrum Translator — ${personaLabel}:\n\n"${trans}"\n\n— via Tantrum Translator app`;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(shareText, {
          mimeType: 'text/plain',
          dialogTitle: 'Share Tantrum Translation',
          UTI: 'public.plain-text',
        });
        trackEvent('shared', { persona: personaLabel });
      } else {
        // Fallback to Share API
        await Share.share({ message: shareText });
        trackEvent('shared', { persona: personaLabel });
      }
    } catch (err: any) {
      console.warn('Share failed:', err);
    }
  };

  // ─── Save API key ───
  const saveApiKey = async () => {
    await AsyncStorage.setItem('openai_api_key', apiKey);
    setShowSettings(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    trackEvent('api_key_saved');
  };

  // ─── Change persona ───
  const changePersona = async (key: string) => {
    const selectedPersona = PERSONAS.find((p) => p.key === key);
    if (selectedPersona?.premium && !isPremium) {
      setShowPaywall(true);
      trackEvent('premium_persona_tapped', { persona: key });
      return;
    }
    setPersona(key);
    await AsyncStorage.setItem('persona', key);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    trackEvent('persona_changed', { persona: key, premium: selectedPersona?.premium });
  };

  // ─── Clear history ───
  const clearHistory = async () => {
    Alert.alert('Clear History', 'Delete all saved translations?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSessions([]);
          await AsyncStorage.removeItem('sessions');
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          trackEvent('history_cleared');
        },
      },
    ]);
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

  // ─── Onboarding gate ───
  if (!hasOnboarded) {
    return (
      <ErrorBoundary>
        <OnboardingScreen onDone={completeOnboarding} />
      </ErrorBoundary>
    );
  }

  // Dynamic styles based on theme
  const dynamicStyles = StyleSheet.create({
    container: { backgroundColor: theme.bg },
    headerTitle: { color: darkMode ? '#fff' : '#fff' },
    headerSubtitle: { color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.7)' },
    personaLabel: { color: darkMode ? 'rgba(187,134,252,0.7)' : 'rgba(255,255,255,0.6)' },
    personaBlurb: { color: darkMode ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.5)' },
    micButton: {
      backgroundColor: darkMode ? 'rgba(187,134,252,0.1)' : 'rgba(255,255,255,0.15)',
      borderColor: darkMode ? 'rgba(187,134,252,0.3)' : 'rgba(255,255,255,0.3)',
    },
    micButtonText: { color: '#fff' },
    micButtonSubtext: { color: darkMode ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.6)' },
    resultCard: {
      backgroundColor: theme.card,
      shadowColor: darkMode ? '#000' : '#000',
    },
    transcriptionText: { color: darkMode ? '#aaa' : '#666' },
    translationText: { color: theme.text },
    historyCard: { backgroundColor: darkMode ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)' },
    historyTranslation: { color: theme.text },
    historyTranscription: { color: darkMode ? '#888' : '#666' },
  });

  return (
    <ErrorBoundary>
      <SafeAreaView style={[styles.container, dynamicStyles.container]}>
        <ExpoStatusBar style="light" />

        {/* ─── Header ─── */}
        <View style={styles.header}>
          <Text style={styles.headerEmoji}>😤👶</Text>
          <Text style={[styles.headerTitle, dynamicStyles.headerTitle]}>Tantrum Translator</Text>
          <Text style={[styles.headerSubtitle, dynamicStyles.headerSubtitle]}>
            {isPremium ? 'Premium · v3.0' : 'Voice Edition · v3.0'}
          </Text>
          {/* Free tier counter */}
          {!isPremium && (
            <View style={styles.freeCounter}>
              <Text style={styles.freeCounterText}>
                {translationsRemaining} free {translationsRemaining === 1 ? 'translation' : 'translations'} left today
              </Text>
            </View>
          )}
        </View>

        {/* ─── Settings + Dark Mode Buttons ─── */}
        <View style={styles.topButtons}>
          {isPremium && (
            <TouchableOpacity style={styles.darkModeButton} onPress={toggleDarkMode}>
              <Text style={styles.darkModeIcon}>{darkMode ? '☀️' : '🌙'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.settingsButton} onPress={() => setShowSettings(true)}>
            <Text style={styles.settingsIcon}>⚙️</Text>
            <Text style={styles.settingsLabel}>{apiKey ? 'Settings' : 'Set API Key'}</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
          // Android-specific: offset for keyboard
          keyboardVerticalOffset={Platform.OS === 'android' ? 0 : 0}
        >
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
            keyboardShouldPersistTaps="handled"
          >
            {/* ─── Persona Selector ─── */}
            <View style={styles.personaSection}>
              <Text style={[styles.personaLabel, dynamicStyles.personaLabel]}>CHOOSE YOUR INTERPRETER</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.personaScroll}>
                {PERSONAS.map((p) => {
                  const active = p.key === persona;
                  const locked = p.premium && !isPremium;
                  return (
                    <TouchableOpacity
                      key={p.key}
                      style={[styles.personaChip, active && styles.personaChipActive, locked && styles.personaChipLocked]}
                      onPress={() => changePersona(p.key)}
                    >
                      <Text style={styles.personaEmoji}>{p.emoji}</Text>
                      <Text style={[styles.personaChipText, active && styles.personaChipTextActive]}>
                        {p.label}
                      </Text>
                      {locked && <Text style={styles.lockIcon}>🔒</Text>}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <Text style={[styles.personaBlurb, dynamicStyles.personaBlurb]}>
                {currentPersona.blurb}
                {currentPersona.premium && !isPremium ? ' (Premium)' : ''}
              </Text>
            </View>

            {/* ─── Mic Button ─── */}
            <View style={styles.micSection}>
              {phase === 'idle' || phase === 'error' ? (
                <TouchableOpacity
                  style={[styles.micButton, dynamicStyles.micButton]}
                  onPress={startRecording}
                >
                  <View style={styles.micButtonInner}>
                    <Text style={styles.micEmoji}>{isAtFreeLimit ? '🔒' : '🎤'}</Text>
                    <Text style={[styles.micButtonText, dynamicStyles.micButtonText]}>
                      {isAtFreeLimit ? 'Upgrade to Continue' : 'Tap to Listen'}
                    </Text>
                    <Text style={[styles.micButtonSubtext, dynamicStyles.micButtonSubtext]}>
                      {isAtFreeLimit ? 'Free limit reached' : 'Hold near the tantrum'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : phase === 'recording' ? (
                <TouchableOpacity
                  style={[styles.micButton, styles.micButtonRecording]}
                  onPress={stopAndTranscribe}
                >
                  <View style={styles.micButtonInner}>
                    <Text style={styles.micEmoji}>🔴</Text>
                    <Text style={[styles.micButtonText, dynamicStyles.micButtonText]}>Recording...</Text>
                    <Text style={[styles.micButtonText, dynamicStyles.micButtonText]}>
                      {formatTime(recordSecs)} / {formatTime(maxRecordingSecs)}
                    </Text>
                    <Text style={[styles.micButtonSubtext, dynamicStyles.micButtonSubtext]}>Tap to stop & translate</Text>
                    {/* Recording progress bar */}
                    <View style={styles.recordingProgress}>
                      <View
                        style={[
                          styles.recordingProgressBar,
                          { width: `${(recordSecs / maxRecordingSecs) * 100}%` },
                        ]}
                      />
                    </View>
                  </View>
                </TouchableOpacity>
              ) : phase === 'transcribing' ? (
                <View style={[styles.micButton, styles.micButtonProcessing]}>
                  <View style={styles.micButtonInner}>
                    <ActivityIndicator size="large" color={theme.accent} />
                    <Text style={[styles.micButtonText, dynamicStyles.micButtonText]}>Transcribing...</Text>
                    <Text style={[styles.micButtonSubtext, dynamicStyles.micButtonSubtext]}>Sending to Whisper AI</Text>
                  </View>
                </View>
              ) : phase === 'translating' ? (
                <View style={[styles.micButton, styles.micButtonProcessing]}>
                  <View style={styles.micButtonInner}>
                    <ActivityIndicator size="large" color={theme.accent} />
                    <Text style={[styles.micButtonText, dynamicStyles.micButtonText]}>Translating...</Text>
                    <Text style={[styles.micButtonSubtext, dynamicStyles.micButtonSubtext]}>
                      {currentPersona.emoji} {currentPersona.label} is interpreting
                    </Text>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.micButton, styles.micButtonDone]}
                  onPress={() => setPhase('idle')}
                >
                  <View style={styles.micButtonInner}>
                    <Text style={styles.micEmoji}>✅</Text>
                    <Text style={[styles.micButtonText, dynamicStyles.micButtonText]}>Done! Tap to record again</Text>
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
                <View style={[styles.resultCard, dynamicStyles.resultCard]}>
                  <View style={styles.resultCardHeader}>
                    <Text style={styles.resultCardLabel}>📝 Heard</Text>
                    <TouchableOpacity
                      style={styles.shareButton}
                      onPress={() => shareTranslation(transcription, 'Heard')}
                    >
                      <Text style={styles.shareButtonText}>📤</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.transcriptionText, dynamicStyles.transcriptionText]}>{transcription}</Text>
                </View>
                <Text style={styles.resultArrow}>↓</Text>
                <View style={[styles.resultCard, styles.translationCard, dynamicStyles.resultCard]}>
                  <View style={styles.resultCardHeader}>
                    <Text style={styles.resultCardLabel}>
                      {currentPersona.emoji} {currentPersona.label}
                    </Text>
                    <View style={styles.resultCardActions}>
                      <TouchableOpacity
                        style={styles.shareButton}
                        onPress={() => shareTranslation(translation, currentPersona.label)}
                      >
                        <Text style={styles.shareButtonText}>📤</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.speakButton}
                        onPress={isSpeaking ? stopSpeaking : () => speakText(translation)}
                      >
                        <Text style={styles.speakButtonText}>
                          {isSpeaking ? '🔇 Stop' : '🔊 Speak'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <Text style={[styles.translationText, dynamicStyles.translationText]}>{translation}</Text>
                </View>
              </View>
            ) : null}

            {/* ─── Session History ─── */}
            {sessions.length > 0 ? (
              <View style={styles.historySection}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle}>Recent Translations</Text>
                <TouchableOpacity onPress={clearHistory}>
                  <Text style={styles.clearHistoryText}>Clear</Text>
                </TouchableOpacity>
              </View>
                {sessions.map((s) => (
                  <View key={s.id} style={[styles.historyCard, dynamicStyles.historyCard]}>
                    <View style={styles.historyCardHeader}>
                      <Text style={styles.historyPersona}>{s.persona}</Text>
                      <Text style={styles.historyTime}>{formatTimestamp(s.timestamp)}</Text>
                    </View>
                    <Text style={[styles.historyTranscription, dynamicStyles.historyTranscription]}>
                      "{s.transcription}"
                    </Text>
                    <Text style={styles.historyArrow}>→</Text>
                    <Text style={[styles.historyTranslation, dynamicStyles.historyTranslation]}>{s.translation}</Text>
                    <View style={styles.historyActions}>
                      <TouchableOpacity
                        style={styles.historySpeakBtn}
                        onPress={isSpeaking ? stopSpeaking : () => speakText(s.translation)}
                      >
                        <Text style={styles.historySpeakText}>🔊 Play</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.historyShareBtn}
                        onPress={() => shareTranslation(s.translation, s.persona)}
                      >
                        <Text style={styles.historySpeakText}>📤 Share</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* ─── Upgrade Banner (free users only) ─── */}
            {!isPremium && (
              <TouchableOpacity style={styles.upgradeBanner} onPress={() => setShowPaywall(true)}>
                <Text style={styles.upgradeBannerEmoji}>✨</Text>
                <View style={styles.upgradeBannerText}>
                  <Text style={styles.upgradeBannerTitle}>Go Premium</Text>
                  <Text style={styles.upgradeBannerSub}>Unlock all personas & unlimited translations</Text>
                </View>
                <Text style={styles.upgradeBannerArrow}>→</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* ─── Settings Modal ─── */}
        <Modal visible={showSettings} animationType="slide" transparent={true}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, darkMode && { backgroundColor: '#1E1E1E' }]}>
              <Text style={[styles.modalTitle, darkMode && { color: '#fff' }]}>⚙️ Settings</Text>

              {/* API Key Section */}
              <Text style={[styles.modalDescription, darkMode && { color: '#aaa' }]}>
                {builtInKey
                  ? 'API key is built into this build via EAS secrets.\nYou can override it with a different key below.'
                  : 'Enter your OpenAI API key to enable speech recognition.\n\nGet one at: platform.openai.com/api-keys\nYour key is stored locally on this device only.'}
              </Text>
              <TextInput
                style={[styles.apiKeyInput, darkMode && { backgroundColor: '#333', color: '#fff', borderColor: '#BB86FC' }]}
                placeholder="sk-..."
                placeholderTextColor={darkMode ? '#666' : '#999'}
                value={apiKey}
                onChangeText={setApiKey}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />

              {/* Premium Status */}
              <View style={styles.settingsPremiumSection}>
                <Text style={[styles.settingsSectionTitle, darkMode && { color: '#fff' }]}>
                  {isPremium ? '✅ Premium Active' : '🔒 Free Tier'}
                </Text>
                {!isPremium ? (
                  <TouchableOpacity
                    style={styles.settingsUpgradeBtn}
                    onPress={() => { setShowSettings(false); setShowPaywall(true); }}
                  >
                    <Text style={styles.settingsUpgradeBtnText}>Upgrade to Premium</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.settingsRestoreBtn} onPress={restorePurchases}>
                  <Text style={styles.settingsRestoreBtnText}>Restore Purchases</Text>
                </TouchableOpacity>
              </View>

              {/* Dark Mode (Premium only) */}
              {isPremium && (
                <View style={styles.settingsDarkModeRow}>
                  <Text style={[styles.settingsSectionTitle, darkMode && { color: '#fff' }]}>🌙 Dark Mode</Text>
                  <TouchableOpacity onPress={toggleDarkMode}>
                    <Text style={styles.toggleIcon}>{darkMode ? 'ON' : 'OFF'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonCancel]}
                  onPress={() => setShowSettings(false)}
                >
                  <Text style={styles.modalButtonText}>Close</Text>
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

        {/* ─── Paywall ─── */}
        <PaywallScreen
          visible={showPaywall}
          onClose={() => setShowPaywall(false)}
          onPurchase={purchasePremium}
          purchasing={purchasing}
        />
      </SafeAreaView>
    </ErrorBoundary>
  );
}

// ═══════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════

const styles = StyleSheet.create({
  // ─── Error Boundary ───
  errorBoundaryContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FF6B6B', padding: 40 },
  errorBoundaryEmoji: { fontSize: 64, marginBottom: 20 },
  errorBoundaryTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  errorBoundaryText: { fontSize: 15, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 30 },
  errorBoundaryButton: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 30, paddingVertical: 14 },
  errorBoundaryButtonText: { fontSize: 16, fontWeight: 'bold', color: '#FF6B6B' },

  // ─── Onboarding ───
  onboardingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FF6B6B', padding: 30 },
  onboardingSkip: { position: 'absolute', top: 50, right: 20 },
  onboardingSkipText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '600' },
  onboardingContent: { alignItems: 'center', marginBottom: 40 },
  onboardingEmoji: { fontSize: 72, marginBottom: 20 },
  onboardingTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 12, textAlign: 'center' },
  onboardingText: { fontSize: 16, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 24 },
  onboardingDots: { flexDirection: 'row', gap: 8, marginBottom: 30 },
  onboardingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  onboardingDotActive: { backgroundColor: '#fff', width: 24 },
  onboardingButton: { backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 40, paddingVertical: 16, width: '100%' },
  onboardingButtonText: { fontSize: 18, fontWeight: 'bold', color: '#FF6B6B', textAlign: 'center' },

  // ─── Container ───
  container: { flex: 1, backgroundColor: '#FF6B6B' },
  flex: { flex: 1 },

  // ─── Header ───
  header: { alignItems: 'center', paddingTop: 15, paddingBottom: 8, paddingHorizontal: 20 },
  headerEmoji: { fontSize: 32 },
  headerTitle: { fontSize: 26, fontWeight: 'bold', color: '#fff', marginTop: 4 },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  freeCounter: {
    marginTop: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  freeCounterText: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600' },

  // ─── Top Buttons ───
  topButtons: { position: 'absolute', top: 50, right: 20, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 10 },
  darkModeButton: {
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20,
    width: 36, height: 36, justifyContent: 'center', alignItems: 'center',
  },
  darkModeIcon: { fontSize: 16 },
  settingsButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
  },
  settingsIcon: { fontSize: 16, marginRight: 4 },
  settingsLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // ─── Content ───
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
  personaChipLocked: { opacity: 0.6 },
  personaEmoji: { fontSize: 16, marginRight: 6 },
  personaChipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  personaChipTextActive: { color: '#FF6B6B' },
  lockIcon: { fontSize: 12, marginLeft: 4 },
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
  recordingProgress: {
    width: SCREEN_WIDTH * 0.45, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 12, overflow: 'hidden',
  },
  recordingProgressBar: {
    height: '100%', backgroundColor: '#ff4444', borderRadius: 2,
  },

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
  resultCardActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  resultArrow: { fontSize: 28, color: 'rgba(255,255,255,0.5)', marginVertical: 8 },
  transcriptionText: { fontSize: 16, color: '#666', fontStyle: 'italic', lineHeight: 22 },
  translationText: { fontSize: 18, color: '#333', fontWeight: '600', lineHeight: 26 },
  shareButton: { backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  shareButtonText: { fontSize: 16 },
  speakButton: { backgroundColor: '#4ECDC4', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  speakButtonText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },

  // ─── History ───
  historySection: { marginBottom: 20 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  historyTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  clearHistoryText: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  historyCard: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 14, padding: 14, marginBottom: 10 },
  historyCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  historyPersona: { color: '#FF6B6B', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  historyTime: { fontSize: 11, color: '#999' },
  historyTranscription: { fontSize: 14, color: '#666', fontStyle: 'italic', marginBottom: 4 },
  historyArrow: { fontSize: 14, color: '#ccc', marginBottom: 4 },
  historyTranslation: { fontSize: 15, color: '#333', fontWeight: '500', marginBottom: 8, lineHeight: 22 },
  historyActions: { flexDirection: 'row', gap: 8 },
  historySpeakBtn: { backgroundColor: '#FF6B6B', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  historyShareBtn: { backgroundColor: '#4ECDC4', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  historySpeakText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // ─── Upgrade Banner ───
  upgradeBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  upgradeBannerEmoji: { fontSize: 28, marginRight: 12 },
  upgradeBannerText: { flex: 1 },
  upgradeBannerTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  upgradeBannerSub: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  upgradeBannerArrow: { color: '#fff', fontSize: 20 },

  // ─── Paywall ───
  paywallOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', padding: 20 },
  paywallContent: {
    backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%',
    maxHeight: '85%',
  },
  paywallClose: { position: 'absolute', top: 16, right: 16, zIndex: 10 },
  paywallCloseText: { fontSize: 20, color: '#999' },
  paywallEmoji: { fontSize: 48, textAlign: 'center', marginBottom: 8 },
  paywallTitle: { fontSize: 22, fontWeight: 'bold', color: '#333', textAlign: 'center', marginBottom: 4 },
  paywallSubtitle: { fontSize: 14, color: '#999', textAlign: 'center', marginBottom: 20 },
  paywallFeatures: { marginBottom: 24, gap: 12 },
  paywallFeature: { flexDirection: 'row', alignItems: 'center' },
  paywallFeatureIcon: { fontSize: 20, marginRight: 12, width: 28 },
  paywallFeatureText: { fontSize: 14, color: '#555', flex: 1 },
  paywallButton: {
    backgroundColor: '#FF6B6B', borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', marginBottom: 8,
  },
  paywallButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  paywallButtonLifetime: {
    backgroundColor: '#4ECDC4', borderRadius: 16, paddingVertical: 16,
    alignItems: 'center',
  },
  paywallButtonTextLifetime: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  paywallRestore: { fontSize: 12, color: '#999', textAlign: 'center', marginTop: 12 },

  // ─── Modal ───
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%' },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  modalDescription: { fontSize: 14, color: '#666', lineHeight: 22, marginBottom: 16 },
  apiKeyInput: { borderWidth: 2, borderColor: '#FF6B6B', borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 16 },
  settingsPremiumSection: { marginBottom: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  settingsSectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  settingsUpgradeBtn: { backgroundColor: '#FF6B6B', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  settingsUpgradeBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  settingsRestoreBtn: { alignItems: 'center', paddingVertical: 8 },
  settingsRestoreBtnText: { color: '#4ECDC4', fontSize: 13, fontWeight: '600' },
  settingsDarkModeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  toggleIcon: { fontSize: 14, fontWeight: 'bold', color: '#4ECDC4' },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalButton: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalButtonCancel: { backgroundColor: '#f0f0f0' },
  modalButtonSave: { backgroundColor: '#FF6B6B' },
  modalButtonText: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
});
