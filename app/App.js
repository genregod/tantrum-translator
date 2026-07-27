import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { API_BASE, RECORD_MAX_MS } from './config';

const FALLBACK_PERSONAS = [
  { key: 'butler', label: 'The Butler', blurb: "A long-suffering English butler." },
  { key: 'barrister', label: 'The Barrister', blurb: "A King's Counsel before the court." },
  { key: 'narrator', label: 'The Documentarian', blurb: 'A hushed wildlife narrator.' },
  { key: 'diplomat', label: 'The Diplomat', blurb: 'A UN envoy issuing a communiqué.' },
  { key: 'duchess', label: 'The Duchess', blurb: 'An imperious, unimpressed aristocrat.' },
];

export default function App() {
  const [personas, setPersonas] = useState(FALLBACK_PERSONAS);
  const [persona, setPersona] = useState('butler');
  const [recording, setRecording] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [history, setHistory] = useState([]);
  const [playingId, setPlayingId] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const soundRef = useRef(null);
  const timerRef = useRef(null);
  const autoStopRef = useRef(null);

  // Pull the persona list from the server so the app and backend stay in sync.
  useEffect(() => {
    fetch(`${API_BASE}/personas`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.personas) && d.personas.length) setPersonas(d.personas);
      })
      .catch(() => { /* offline: keep the built-in list */ });
  }, []);

  // Always release audio resources on unmount.
  useEffect(() => {
    return () => {
      if (soundRef.current) soundRef.current.unloadAsync().catch(() => {});
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
    };
  }, []);

  async function startRecording() {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone required', 'The translator cannot hear the young master without it.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      setRecording(rec);
      setStatus('Listening to the grievance…');
      setElapsed(0);

      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      autoStopRef.current = setTimeout(() => { stopAndTranslate(rec); }, RECORD_MAX_MS);
    } catch (err) {
      Alert.alert('Could not start recording', String(err?.message || err));
    }
  }

  async function stopAndTranslate(recArg) {
    const rec = recArg || recording;
    if (!rec) return;

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }

    setRecording(null);
    setIsBusy(true);
    setStatus('Consulting the household staff…');

    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      if (!uri) throw new Error('Recording produced no file.');

      const form = new FormData();
      form.append('audio', {
        uri,
        name: 'tantrum.m4a',
        type: 'audio/m4a',
      });
      form.append('persona', persona);

      const res = await fetch(`${API_BASE}/translate`, { method: 'POST', body: form });
      const text = await res.text();
      if (!res.ok) throw new Error(text.slice(0, 300));

      const data = JSON.parse(text);
      const entry = {
        id: `${Date.now()}`,
        transcript: data.transcript,
        translation: data.translation,
        personaLabel: data.personaLabel,
        audioBase64: data.audioBase64,
        at: new Date(),
      };
      setHistory((h) => [entry, ...h]);
      setStatus('');
      playEntry(entry);
    } catch (err) {
      setStatus('');
      Alert.alert('Translation failed', String(err?.message || err));
    } finally {
      setIsBusy(false);
    }
  }

  async function playEntry(entry) {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
      // expo-av can't play a raw base64 string, so stage it as a real file.
      const path = `${FileSystem.cacheDirectory}tt_${entry.id}.mp3`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) {
        await FileSystem.writeAsStringAsync(path, entry.audioBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });
      soundRef.current = sound;
      setPlayingId(entry.id);
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) setPlayingId(null);
      });
    } catch (err) {
      Alert.alert('Playback failed', String(err?.message || err));
      setPlayingId(null);
    }
  }

  const isRecording = Boolean(recording);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>The Tantrum Translator</Text>
          <Text style={styles.subtitle}>
            Rendering the grievances of the very small into the Queen's English
          </Text>

          <Text style={styles.sectionLabel}>CHOOSE YOUR INTERPRETER</Text>
          <View style={styles.personaRow}>
            {personas.map((p) => {
              const active = p.key === persona;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => setPersona(p.key)}
                  style={[styles.personaChip, active && styles.personaChipActive]}
                >
                  <Text style={[styles.personaText, active && styles.personaTextActive]}>
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.blurb}>
            {personas.find((p) => p.key === persona)?.blurb || ''}
          </Text>

          <Pressable
            onPress={isRecording ? () => stopAndTranslate() : startRecording}
            disabled={isBusy}
            style={[
              styles.recordBtn,
              isRecording && styles.recordBtnActive,
              isBusy && styles.recordBtnDisabled,
            ]}
          >
            {isBusy ? (
              <ActivityIndicator color="#1a1033" />
            ) : (
              <Text style={styles.recordBtnText}>
                {isRecording ? `STOP  ·  ${elapsed}s` : 'RECORD THE TANTRUM'}
              </Text>
            )}
          </Pressable>

          {Boolean(status) && <Text style={styles.status}>{status}</Text>}

          {history.length === 0 && !isBusy && (
            <Text style={styles.empty}>
              No grievances on record. The household is, for the moment, at peace.
            </Text>
          )}

          {history.map((entry) => (
            <View key={entry.id} style={styles.card}>
              <Text style={styles.cardPersona}>{entry.personaLabel}</Text>
              <Text style={styles.heard}>
                Heard: "{entry.transcript || '(wordless howling)'}"
              </Text>
              <Text style={styles.translation}>{entry.translation}</Text>
              <Pressable onPress={() => playEntry(entry)} style={styles.playBtn}>
                <Text style={styles.playBtnText}>
                  {playingId === entry.id ? '▮▮  Playing…' : '▶  Play translation'}
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1a1033' },
  scroll: { padding: 20, paddingBottom: 60 },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#f4e9c8',
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    color: '#b9a8d8',
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 6,
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8d7ab5',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  personaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  personaChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#463569',
    backgroundColor: '#241847',
  },
  personaChipActive: { backgroundColor: '#f4e9c8', borderColor: '#f4e9c8' },
  personaText: { color: '#c9bce4', fontSize: 13, fontWeight: '600' },
  personaTextActive: { color: '#1a1033' },
  blurb: {
    color: '#8d7ab5',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 10,
    marginBottom: 24,
  },
  recordBtn: {
    backgroundColor: '#f4e9c8',
    paddingVertical: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 64,
  },
  recordBtnActive: { backgroundColor: '#e5645f' },
  recordBtnDisabled: { opacity: 0.6 },
  recordBtnText: {
    color: '#1a1033',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 1,
  },
  status: {
    color: '#b9a8d8',
    textAlign: 'center',
    marginTop: 14,
    fontStyle: 'italic',
  },
  empty: {
    color: '#6d5c92',
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 40,
    fontSize: 13,
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#241847',
    borderRadius: 16,
    padding: 18,
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#3a2b5c',
  },
  cardPersona: {
    color: '#f4e9c8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  heard: {
    color: '#8d7ab5',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 12,
    lineHeight: 17,
  },
  translation: {
    color: '#efe6d0',
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 16,
  },
  playBtn: {
    borderWidth: 1,
    borderColor: '#f4e9c8',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  playBtnText: { color: '#f4e9c8', fontWeight: '700', fontSize: 13 },
});
