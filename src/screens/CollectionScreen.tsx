import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  InputAccessoryView,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Alert,
  Image,
  Linking,
  Animated,
  ActionSheetIOS,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useNavigation, NavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Session } from '@supabase/supabase-js';
import { colors, typography, spacing, radius, gradients, boardColorMap } from '../theme';
import { useStore } from '../hooks/useStore';
import { supabase, Pedal, UserPedal, PedalColorway, invokeEdgeFunction } from '../lib/supabase';
import { PedalCard, CategoryBadge, EmptyState, SocialShareSheet, FsftShareCard, CollectionShareCard } from '../components';
import { SwipeDismissSheet } from '../components/SwipeDismissSheet';
import { NetworkErrorView } from '../components/NetworkErrorView';
import { classifyError, extractHttpStatus, type ClassifiedError } from '../lib/networkError';
import type { CollectionPedal, PriceMode } from '../components';
import { TabParamList } from '../types/navigation';
import { reverbSearchUrl, reverbAffiliateUrl } from '../lib/reverb';
import { shareGasList, shareNewPedal, shareFsftList, shareCollectionList, shareAsImage, type FsftPedal } from '../lib/share';
import { hasBetaFullAccess } from '../lib/subscription';
import { useFormatMoney } from '../hooks/useFormatMoney';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

// Reverb-aligned condition taxonomy
const CONDITIONS = [
  'Excellent',
  'Very Good',
  'Good',
  'Fair',
  'Poor',
  'Non Functioning',
  'Brand New',
] as const;
export type PedalCondition = typeof CONDITIONS[number];

// Date helpers: DB stores YYYY-MM-DD, UI shows MM-DD-YYYY
const toDisplayDate = (dbDate: string) => {
  const parts = dbDate.split('-');
  if (parts.length !== 3 || parts[0].length !== 4) return dbDate;
  return `${parts[1]}-${parts[2]}-${parts[0]}`;
};
const toDbDate = (displayDate: string) => {
  const parts = displayDate.split('-');
  if (parts.length !== 3 || parts[2].length !== 4) return displayDate;
  return `${parts[2]}-${parts[0]}-${parts[1]}`;
};

// ─── DateField ────────────────────────────────────────────────────────────────
const DateField: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string }> = ({
  value, onChange, placeholder = 'MM-DD-YYYY',
}) => {
  const [show, setShow] = useState(false);

  const dateFromDisplay = (s: string) => {
    const parts = s.split('-');
    if (parts.length === 3 && parts[2].length === 4) {
      const d = new Date(`${parts[2]}-${parts[0]}-${parts[1]}`);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  };

  const formatDate = (d: Date) => {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}-${dd}-${yyyy}`;
  };

  return (
    <>
      <TouchableOpacity
        style={[dateFieldStyles.input, show && dateFieldStyles.inputActive]}
        onPress={() => { Haptics.selectionAsync(); setShow(s => !s); }}
        activeOpacity={0.7}
      >
        <Text style={value ? dateFieldStyles.valueText : dateFieldStyles.placeholder}>
          {value || placeholder}
        </Text>
        <Ionicons name={show ? 'chevron-up' : 'calendar-outline'} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={dateFromDisplay(value)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_, selected) => {
            setShow(false);
            if (selected) onChange(formatDate(selected));
          }}
          maximumDate={new Date(2100, 11, 31)}
          themeVariant="light"
          accentColor={colors.teal}
          style={Platform.OS === 'ios' ? dateFieldStyles.inlinePicker : undefined}
        />
      )}
    </>
  );
};

const dateFieldStyles = StyleSheet.create({
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt ?? '#F5F5F5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: colors.border,
  },
  valueText: {
    fontSize: 15,
    fontFamily: 'System',
    color: colors.textPrimary,
  },
  placeholder: {
    fontSize: 15,
    fontFamily: 'System',
    color: colors.textSecondary,
  },
  inputActive: {
    borderColor: colors.teal,
  },
  inlinePicker: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 10,
  },
});

const CATEGORIES = [
  // Drive family
  'drive',
  'fuzz',
  'distortion',
  'boost',
  // Dynamics & control
  'compressor',
  'volume',
  'noisegate',
  'buffer',
  // Tone shaping
  'eq',
  'wah',
  'preamp',
  // Time-based
  'delay',
  'reverb',
  // Modulation
  'chorus',
  'phaser',
  'flanger',
  'tremolo',
  'modulation',
  // Pitch & octave
  'pitch',
  'octave',
  // Other
  'looper',
  'ambient',
  'synth',
  'multifx',
  'modeler',
  'utility',
  'other',
];

type PedalSearchLocalResponse = {
  pedals?: Pedal[];
};

type SearchListingsResponse = {
  listings?: Array<{
    title: string;
    price: number | null;
    currency: string | null;
    condition: string | null;
    date: string | null;
    url: string | null;
    photo_url?: string | null;
  }>;
  _debug?: unknown;
};

type SearchReverbResponse = {
  results?: ReverbResult[];
  pedals?: Pedal[];
  _debug?: unknown;
};

type SearchUpsertResponse = {
  pedal?: Pedal;
};

export default function CollectionScreen() {
  const targetPriceAccessoryId = 'targetPriceAccessory';
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<TabParamList, 'Vault'>>();
  const navigation = useNavigation<NavigationProp<TabParamList>>();
  const { session, profile, ownedPedals, wishlistPedals, retiredPedals, listedPedals, totalInvested, totalMarketValue, marketValues, fetchPedals, userImageUrls, userImageThumbUrls, refreshUserImages, viewMode, boards, updateListingStatus, wifeMode, openPaywall } = useStore();
  const { fmt, fmtDelta } = useFormatMoney();

  const [activeTab, setActiveTab] = useState<'owned' | 'wishlist' | 'listed'>('owned');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  // Scan-to-add: runs picker from the main screen (no Modal in the VC stack)
  // then opens AddPedalModal with the identified query pre-filled.
  const [isScanningMain, setIsScanningMain] = useState(false);
  const [scanInitialSearch, setScanInitialSearch] = useState<string | null>(null);
  // When true, AddPedalModal opens directly to the manual-add form (scan failed).
  const [scanOpenManual, setScanOpenManual] = useState(false);

  // Share nudge — shown briefly after an owned pedal is added
  const [shareNudge, setShareNudge] = useState<{ brand: string; model: string } | null>(null);
  const [gasListShareOpen, setGasListShareOpen] = useState(false);
  const nudgeOpacity = useRef(new Animated.Value(0)).current;
  const nudgeDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showShareNudge = useCallback((brand: string, model: string) => {
    if (nudgeDismissRef.current) clearTimeout(nudgeDismissRef.current);
    setShareNudge({ brand, model });
    Animated.spring(nudgeOpacity, { toValue: 1, tension: 60, friction: 10, useNativeDriver: true }).start();
    nudgeDismissRef.current = setTimeout(() => {
      Animated.timing(nudgeOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setShareNudge(null));
    }, 5000);
  }, [nudgeOpacity]);
  useEffect(() => () => { if (nudgeDismissRef.current) clearTimeout(nudgeDismissRef.current); }, []);

  // ── Scan-to-add ─────────────────────────────────────────────────────────────
  // The picker MUST run from the main screen (no Modal in the VC stack).
  // reopenModalRef: when scan is triggered from inside AddPedalModal, we close
  // the modal first, run the scan, then reopen (with results on success, or
  // empty on cancel/error so the user can try again manually).
  const reopenModalAfterScan = useRef(false);

  const doScanFromMainScreen = useCallback(async (useCamera: boolean) => {
    if (useCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow camera access in Settings.');
        if (reopenModalAfterScan.current) { reopenModalAfterScan.current = false; setShowAddModal(true); }
        return;
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow photo library access in Settings.');
        if (reopenModalAfterScan.current) { reopenModalAfterScan.current = false; setShowAddModal(true); }
        return;
      }
    }
    setIsScanningMain(true);
    try {
      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.8, exif: false })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.8, exif: false,
          });
      if (result.canceled || !result.assets?.[0]?.uri) {
        // User cancelled — reopen modal if we came from it
        if (reopenModalAfterScan.current) { reopenModalAfterScan.current = false; setShowAddModal(true); }
        return;
      }
      // 1568px is Claude vision's max useful long edge; 0.8 keeps small label
      // text legible. Payload is ~3x larger than the old 800px/0.65 but still
      // well under edge function body limits (~1MB base64 typical).
      const processed = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1568 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      const base64 = await FileSystem.readAsStringAsync(processed.uri, { encoding: 'base64' });
      const { data, error } = await invokeEdgeFunction<{ brand: string; model: string }>('scan-pedal', {
        imageBase64: base64, mediaType: 'image/jpeg',
      });
      // 403 = free scan quota exhausted → paywall, not the manual-add fallback
      if (error) {
        const status = (error as { context?: { status?: number } }).context?.status;
        if (status === 403) {
          setTimeout(() => openPaywall('scan'), 600);
          return;
        }
      }
      if (error || !data?.brand) {
        setScanOpenManual(true);
        setTimeout(() => {
          setShowAddModal(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }, 600);
        return;
      }
      const query = `${data.brand} ${data.model}`.trim();
      setScanInitialSearch(query);
      // Give iOS extra time to fully settle the VC hierarchy after the picker
      // dismisses before presenting the Modal. In Expo Go the hierarchy is more
      // complex and needs a longer window than in a standalone build.
      setTimeout(() => {
        setShowAddModal(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }, 600);
    } catch (e) {
      console.error('[Scan]', e);
      setScanOpenManual(true);
      setTimeout(() => setShowAddModal(true), 600);
    } finally {
      setIsScanningMain(false);
      reopenModalAfterScan.current = false;
    }
  }, [openPaywall]);

  // The single "Add a Pedal" button — shows three paths.
  const handleAddPedalPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Add a Pedal', 'How would you like to add it?', [
      // setTimeout lets the Alert dismiss animation fully complete before
      // any native picker VC is presented — avoids presentation race crash.
      { text: 'Take Photo', onPress: () => setTimeout(() => doScanFromMainScreen(true), 400) },
      { text: 'Photo Library', onPress: () => setTimeout(() => doScanFromMainScreen(false), 400) },
      { text: 'Add Manually', onPress: () => setShowAddModal(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [doScanFromMainScreen]);
  // ────────────────────────────────────────────────────────────────────────────

  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailPedal, setDetailPedal] = useState<UserPedal | null>(null);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [reassignQuery, setReassignQuery] = useState('');
  const [reassignResults, setReassignResults] = useState<Pedal[]>([]);
  const [reassignReverbResults, setReassignReverbResults] = useState<ReverbResult[]>([]);
  const [reassignSearching, setReassignSearching] = useState(false);
  const [reassignSaving, setReassignSaving] = useState(false);
  const reassignDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reassignSearchIdRef = useRef(0);
  const [detailColorways, setDetailColorways] = useState<PedalColorway[]>([]);
  const [detailColorwayId, setDetailColorwayId] = useState<string | null>(null);
  const [acquiredDate, setAcquiredDate] = useState('');
  const [acquiredMethod, setAcquiredMethod] = useState<'purchase' | 'trade'>('purchase');
  const [acquiredPrice, setAcquiredPrice] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const targetPriceInputRef = useRef<TextInput | null>(null);
  const [acquiredFrom, setAcquiredFrom] = useState('');
  const [acquiredTradeFor, setAcquiredTradeFor] = useState('');
  const [acquiredTradeWith, setAcquiredTradeWith] = useState('');
  const [acquiredNotes, setAcquiredNotes] = useState('');
  const [condition, setCondition] = useState<string>('');
  const [serialNumber, setSerialNumber] = useState('');
  const [listingStatus, setListingStatus] = useState<'for_sale' | 'for_trade' | 'for_sale_or_trade' | null>(null);
  const [askingPrice, setAskingPrice] = useState('');
  const [tradeWants, setTradeWants] = useState('');
  const [isOnLoan, setIsOnLoan] = useState(false);
  const [loanedTo, setLoanedTo] = useState('');
  const [fsftShareOpen, setFsftShareOpen] = useState(false);
  const [collectionShareModalOpen, setCollectionShareModalOpen] = useState(false);
  const [collectionPage, setCollectionPage] = useState(0);
  // Share config state
  const [shareConfigOpen, setShareConfigOpen] = useState(false);
  const [shareSource, setShareSource] = useState<'collection' | 'gas'>('collection');
  const [shareSelCategories, setShareSelCategories] = useState<string[]>([]);
  const [sharePriceMode, setSharePriceMode] = useState<PriceMode>('none');
  const [shareSort, setShareSort] = useState<'newest' | 'oldest' | 'az' | 'value'>('newest');
  const [shareFsftOnly, setShareFsftOnly] = useState(false);
  const [categoryOverride, setCategoryOverride] = useState<string | null>(null);
  const [retiredDate, setRetiredDate] = useState('');
  const [retiredMethod, setRetiredMethod] = useState<'sale' | 'trade'>('sale');
  const [retiredPrice, setRetiredPrice] = useState('');
  const [retiredTradeFor, setRetiredTradeFor] = useState('');
  const [retiredTo, setRetiredTo] = useState('');
  const [retiredNotes, setRetiredNotes] = useState('');
  const [retiredReason, setRetiredReason] = useState<string | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const detailScrollRef = useRef<ScrollView | null>(null);
  const scrollToField = (fieldRef: React.RefObject<View | null>) => {
    setTimeout(() => {
      fieldRef.current?.measureLayout(
        detailScrollRef.current as any,
        (_x, y) => { detailScrollRef.current?.scrollTo({ y: y - 16, animated: true }); },
        () => {}
      );
    }, 100);
  };
  const serialNumberRef = useRef<View | null>(null);
  const notesRef = useRef<View | null>(null);
  const retiredNotesRef = useRef<View | null>(null);
  const [showRetireSection, setShowRetireSection] = useState(false);
  const [retireTradeSearch, setRetireTradeSearch] = useState('');
  const [retireTradeResults, setRetireTradeResults] = useState<Pedal[]>([]);

  const handleShareGasList = useCallback(async () => {
    const gasPedals = wishlistPedals
      .filter(p => p.pedal?.brand && p.pedal?.model)
      .map(p => ({ brand: p.pedal!.brand, model: p.pedal!.model }));
    if (gasPedals.length === 0) {
      Alert.alert('No wishlist pedals yet', 'Add a few pedals to your GAS list, then share it.');
      return;
    }
    Haptics.selectionAsync();
    try {
      await shareGasList(gasPedals);
    } catch {
      // Fallback to social-specific sheet if native share fails on this device.
      setGasListShareOpen(true);
    }
  }, [wishlistPedals]);
  const handleShareFsftList = useCallback(async () => {
    const pedals: FsftPedal[] = listedPedals
      .filter(p => p.pedal?.brand && p.pedal?.model && p.listing_status)
      .map(p => ({
        brand: p.pedal!.brand,
        model: p.pedal!.model,
        listing_status: p.listing_status!,
        asking_price: p.asking_price ?? null,
      }));
    if (pedals.length === 0) {
      Alert.alert('Nothing listed yet', 'Mark a pedal as For Sale or For Trade first.');
      return;
    }
    Haptics.selectionAsync();
    try {
      // Prefer image card; fall back to text sheet
      if (fsftCardRef.current) {
        const uri = await captureRef(fsftCardRef, { format: 'png', quality: 1, result: 'tmpfile' });
        try {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
            return;
          }
        } finally {
          FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        }
      }
      await shareFsftList(pedals);
    } catch {
      setFsftShareOpen(true);
    }
  }, [listedPedals]);

  const COLLECTION_PAGE_SIZE = 9;

  // Source pedals for the share config — owned collection OR wishlist (GAS).
  // listedPedals is already a subset of ownedPedals, so ownedPedals is the sole
  // source for the collection view to avoid duplicating listed pedals.
  const collectionAllPedals: CollectionPedal[] = useMemo(() => {
    const source = shareSource === 'gas' ? wishlistPedals : ownedPedals;
    return source
      .filter(p => p.pedal?.brand && p.pedal?.model)
      .map(p => ({
        id:            p.id,
        brand:         p.pedal!.brand,
        model:         p.pedal!.model,
        category:      p.category_override ?? p.pedal!.category ?? 'drive',
        imageUrl:      userImageUrls[p.id] ?? p.colorway?.image_url ?? p.pedal!.image_url ?? null,
        marketValue:   p.pedal?.id ? (marketValues[p.pedal.id] ?? null) : null,
        purchasePrice: shareSource === 'gas' ? (p.target_price ?? null) : (p.purchase_price ?? null),
        askingPrice:   p.asking_price ?? null,
        listingStatus: p.listing_status ?? null,
        acquiredDate:  p.acquired_date ?? null,
      }));
  }, [shareSource, ownedPedals, wishlistPedals, userImageUrls, marketValues]);

  // Available categories (only cats the user actually has)
  const availableShareCategories = useMemo(() => {
    const cats = new Set<string>();
    collectionAllPedals.forEach(p => { if (p.category) cats.add(p.category); });
    return Array.from(cats).sort();
  }, [collectionAllPedals]);

  // Filtered + sorted pedals based on current config
  const shareFilteredPedals: CollectionPedal[] = useMemo(() => {
    let pedals = collectionAllPedals;
    if (shareSelCategories.length > 0) {
      pedals = pedals.filter(p => shareSelCategories.includes(p.category));
    }
    if (shareFsftOnly) {
      pedals = pedals.filter(p => p.listingStatus != null);
    }
    pedals = [...pedals];
    switch (shareSort) {
      case 'oldest':
        pedals.sort((a, b) => (a.acquiredDate ?? '').localeCompare(b.acquiredDate ?? ''));
        break;
      case 'az':
        pedals.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
        break;
      case 'value':
        pedals.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
        break;
      default: // 'newest'
        pedals.sort((a, b) => (b.acquiredDate ?? '').localeCompare(a.acquiredDate ?? ''));
        break;
    }
    return pedals;
  }, [collectionAllPedals, shareSelCategories, shareFsftOnly, shareSort]);

  // Paginate filtered results
  const collectionPages: CollectionPedal[][] = useMemo(() => {
    const pages: CollectionPedal[][] = [];
    for (let i = 0; i < shareFilteredPedals.length; i += COLLECTION_PAGE_SIZE) {
      pages.push(shareFilteredPedals.slice(i, i + COLLECTION_PAGE_SIZE));
    }
    return pages;
  }, [shareFilteredPedals]);

  const currentPagePedals  = collectionPages[collectionPage] ?? [];
  const totalCollectionPages = collectionPages.length;

  // Build a human subtitle for the card header (reflects active filters)
  const shareCardSubtitle = useMemo(() => {
    const parts: string[] = [];
    if (shareSelCategories.length === 1) parts.push(shareSelCategories[0]);
    else if (shareSelCategories.length > 1) parts.push(`${shareSelCategories.length} categories`);
    if (shareFsftOnly) parts.push('FS/FT only');
    const n = shareFilteredPedals.length;
    parts.push(`${n} pedal${n !== 1 ? 's' : ''}`);
    return parts.join(' · ');
  }, [shareSelCategories, shareFsftOnly, shareFilteredPedals.length]);

  const _doShareCollectionCard = useCallback(async (pageIndex: number, pagePedals: CollectionPedal[]) => {
    const viewNode = pageRefs.current[pageIndex];
    let uri: string | null = null;
    try {
      if (viewNode) {
        await new Promise(resolve => setTimeout(resolve, 800));
        uri = await captureRef({ current: viewNode }, { format: 'png', quality: 1, result: 'tmpfile' });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
          return;
        }
      }
      await shareCollectionList(pagePedals.map(p => ({ brand: p.brand, model: p.model })), profile?.display_name ?? undefined);
    } catch {
      await shareCollectionList(pagePedals.map(p => ({ brand: p.brand, model: p.model })), profile?.display_name ?? undefined);
    } finally {
      if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }, [profile?.display_name]);

  // Open the config sheet for the owned collection
  const handleShareCollection = useCallback(() => {
    setShareSource('collection');
    if (ownedPedals.filter(p => p.pedal?.brand && p.pedal?.model).length === 0) return;
    Haptics.selectionAsync();
    setCollectionPage(0);
    setShareFsftOnly(false);
    setShareConfigOpen(true);
  }, [ownedPedals]);

  // Open the config sheet for the GAS wishlist
  const handleShareGasCard = useCallback(() => {
    setShareSource('gas');
    if (wishlistPedals.filter(p => p.pedal?.brand && p.pedal?.model).length === 0) return;
    Haptics.selectionAsync();
    setCollectionPage(0);
    setShareFsftOnly(false);
    setShareSelCategories([]);
    setSharePriceMode('none');
    setShareSort('newest');
    setShareConfigOpen(true);
  }, [wishlistPedals]);

  // Share the current page with current config
  const handleShareCurrentPage = useCallback(async () => {
    Haptics.selectionAsync();
    setShareConfigOpen(false);
    await new Promise(resolve => setTimeout(resolve, 300));
    await _doShareCollectionCard(collectionPage, currentPagePedals);
  }, [collectionPage, currentPagePedals, _doShareCollectionCard]);

  const handleShareAllPages = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSavingAllPages(true);
    setShareConfigOpen(false);
    try {
      await new Promise(resolve => setTimeout(resolve, 1200));
      for (let i = 0; i < collectionPages.length; i++) {
        const viewNode = pageRefs.current[i];
        if (!viewNode) continue;
        const uri = await captureRef({ current: viewNode }, { format: 'png', quality: 1, result: 'tmpfile' });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
        }
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    } catch {
      Alert.alert('Something went wrong', 'Could not share images. Try again.');
    } finally {
      setSavingAllPages(false);
    }
  }, [collectionPages]);

  // Save every page as an image to the camera roll
  const handleSaveAllPages = useCallback(async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow Photos access to save your collection images.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSavingAllPages(true);
    setShareConfigOpen(false);
    try {
      // Wait for all off-screen images to finish loading
      await new Promise(resolve => setTimeout(resolve, 1200));
      const saved: string[] = [];
      for (let i = 0; i < collectionPages.length; i++) {
        const viewNode = pageRefs.current[i];
        if (!viewNode) continue;
        const uri = await captureRef({ current: viewNode }, { format: 'png', quality: 1, result: 'tmpfile' });
        await MediaLibrary.saveToLibraryAsync(uri);
        saved.push(uri);
        // Clean up temp file after saving to camera roll
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
      Alert.alert(
        'Saved to Photos',
        `${saved.length} image${saved.length !== 1 ? 's' : ''} saved to your camera roll.`,
      );
    } catch (e) {
      Alert.alert('Something went wrong', 'Could not save images. Try again.');
    } finally {
      setSavingAllPages(false);
    }
  }, [collectionPages]);

  const [retireTradeSearching, setRetireTradeSearching] = useState(false);
  const [retireNewPedal, setRetireNewPedal] = useState<Pedal | null>(null);
  const [retireNewColorways, setRetireNewColorways] = useState<PedalColorway[]>([]);
  const [retireNewColorwayId, setRetireNewColorwayId] = useState<string | null>(null);
  const [retireCashPaid, setRetireCashPaid] = useState('');
  const [retireTradeReverbResults, setRetireTradeReverbResults] = useState<ReverbResult[]>([]);
  const [retireTradeUpserting, setRetireTradeUpserting] = useState(false);
  const retireTradeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fsftCardRef = useRef<View>(null);
  // One ref per page — all cards mounted simultaneously so images pre-load in parallel
  const pageRefs = useRef<(View | null)[]>([]);
  const [savingAllPages, setSavingAllPages] = useState(false);
  const [pedalChain, setPedalChain] = useState<UserPedal[]>([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [detailUserImageUrl, setDetailUserImageUrl] = useState<string | null>(null);
  const [detailImageFailed, setDetailImageFailed] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [wishlistListings, setWishlistListings] = useState<Array<{ title: string; price: number | null; currency: string | null; condition: string | null; date: string | null; url: string | null; photo_url?: string | null }>>([]);
  const [wishlistSort, setWishlistSort] = useState<'newest' | 'price'>('newest');
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [wishlistError, setWishlistError] = useState<ClassifiedError | null>(null);

  useEffect(() => {
    const initial = route.params?.initialTab;
    if (!initial) return;
    setActiveTab(initial);
    setSearchQuery('');
    setActiveCategory(null);
  }, [route.params?.initialTab]);

  useEffect(() => {
    if (!detailPedal) return;
    setDetailUserImageUrl(userImageUrls[detailPedal.id] ?? null);
    setDetailImageFailed(false);
  }, [detailPedal?.id, userImageUrls]);

  useEffect(() => {
    const openId = route.params?.openPedalId;
    if (!openId || detailPedal?.id === openId) return;
    const all = [...ownedPedals, ...wishlistPedals, ...retiredPedals];
    const found = all.find(p => p.id === openId);
    if (found) {
      openDetail(found);
      navigation.setParams({ openPedalId: undefined });
    }
  }, [route.params?.openPedalId, ownedPedals, wishlistPedals, retiredPedals, detailPedal?.id, navigation]);

  useEffect(() => {
    if (!route.params?.openAddModal) return;
    setShowAddModal(true);
    navigation.setParams({ openAddModal: undefined });
  }, [route.params?.openAddModal, navigation]);

  useEffect(() => {
    const scan = route.params?.triggerScan;
    if (!scan) return;
    navigation.setParams({ triggerScan: undefined });
    // Small delay so the tab navigation animation finishes before the
    // native picker is presented — avoids any VC hierarchy issues.
    const t = setTimeout(() => doScanFromMainScreen(scan === 'camera'), 400);
    return () => clearTimeout(t);
  }, [route.params?.triggerScan, navigation, doScanFromMainScreen]);

  // Filtered list
  const rawList = activeTab === 'owned' ? ownedPedals : activeTab === 'wishlist' ? wishlistPedals : listedPedals;
  const filtered = rawList.filter(p => {
    const pedal = p.pedal;
    if (!pedal) return false;
    const category = p.category_override ?? pedal.category;
    const q = searchQuery.toLowerCase();
    const matchesSearch = q
      ? pedal.brand.toLowerCase().includes(q) || pedal.model.toLowerCase().includes(q)
      : true;
    const matchesCategory = activeCategory ? category === activeCategory : true;
    return matchesSearch && matchesCategory;
  });

  const boardColorsByPedalId = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const board of boards) {
      const color = boardColorMap[board.color ?? 'teal'] ?? colors.teal;
      for (const slot of board.slots ?? []) {
        if (!slot.pedal_id) continue;
        const list = map[slot.pedal_id] ?? [];
        if (!list.includes(color)) list.push(color);
        map[slot.pedal_id] = list;
      }
    }
    return map;
  }, [boards]);

  const detailBoard = useMemo(() => {
    if (!detailPedal) return null;
    const pedalId = detailPedal.pedal_id;
    if (!pedalId) return null;
    for (const board of boards) {
      if ((board.slots ?? []).some(s => s.pedal_id === pedalId)) {
        return board;
      }
    }
    return null;
  }, [boards, detailPedal]);

  const handleTabPress = (tab: 'owned' | 'wishlist' | 'listed') => {
    Haptics.selectionAsync();
    setActiveTab(tab);
    setSearchQuery('');
    setActiveCategory(null);
  };

  const loadColorwaysForPedal = async (pedalId: string) => {
    const { data } = await supabase
      .from('pedal_colorways')
      .select('*')
      .eq('pedal_id', pedalId)
      .order('is_default', { ascending: false });
    setDetailColorways((data as PedalColorway[]) ?? []);
  };

  const openDetail = async (item: UserPedal) => {
    setDetailPedal(item);
    setShowDetailModal(true);
    navigation.setParams({ openPedalId: undefined });
    setDetailColorwayId(item.colorway_id ?? null);
    setAcquiredDate(item.acquired_date ? toDisplayDate(item.acquired_date) : '');
    setAcquiredMethod(
      item.acquired_method ??
      (item.purchase_price != null ? 'purchase' : item.acquired_trade_for ? 'trade' : 'purchase')
    );
    setAcquiredPrice(item.purchase_price != null ? String(item.purchase_price) : '');
    setAcquiredFrom(item.acquired_from ?? '');
    setAcquiredTradeFor(item.acquired_trade_for ?? '');
    setAcquiredTradeWith(item.acquired_trade_with ?? '');
    setAcquiredNotes(item.notes ?? '');
    setCondition(item.condition ?? '');
    setSerialNumber(item.serial_number ?? '');
    setListingStatus(item.listing_status ?? null);
    setAskingPrice(item.asking_price != null ? String(item.asking_price) : '');
    setTradeWants(item.trade_wants ?? '');
    setIsOnLoan(item.loaned_to != null);
    setLoanedTo(item.loaned_to ?? '');
    setTargetPrice((item as unknown as Record<string, unknown>).target_price != null ? String((item as unknown as Record<string, unknown>).target_price) : '');
    setRetiredDate(item.retired_date ? toDisplayDate(item.retired_date) : '');
    setRetiredMethod(
      item.retired_method ??
      (item.retired_price != null ? 'sale' : item.retired_trade_for ? 'trade' : 'sale')
    );
    setRetiredPrice(item.retired_price != null ? String(item.retired_price) : '');
    setRetiredTradeFor(item.retired_trade_for ?? '');
    setRetiredTo(item.retired_to ?? '');
    setRetiredNotes(item.retired_notes ?? '');
    setRetiredReason(null);
    setShowRetireSection(item.status === 'retired');
    setDetailUserImageUrl(userImageUrls[item.id] ?? null);
    setCategoryOverride(item.category_override ?? null);
    if (item.pedal_id) await loadColorwaysForPedal(item.pedal_id);
    if (item.status === 'wishlist') {
      setWishlistListings([]);
      fetchWishlistListings(item, wishlistSort);
      setPedalChain([]);
    } else {
      setWishlistListings([]);
      buildPedalChain(item);
    }
  };

  const handleRetireTradeSearch = (query: string) => {
    setRetireTradeSearch(query);
    setRetireNewPedal(null);
    setRetireNewColorways([]);
    setRetireNewColorwayId(null);
    if (retireTradeDebounce.current) clearTimeout(retireTradeDebounce.current);
    if (!query.trim()) { setRetireTradeResults([]); setRetireTradeReverbResults([]); return; }
    retireTradeDebounce.current = setTimeout(async () => {
      const safe = query.replace(/[^a-zA-Z0-9 \-_.]/g, '').trim().slice(0, 100);
      if (!safe) { setRetireTradeResults([]); setRetireTradeReverbResults([]); return; }
      setRetireTradeSearching(true);
      // Fire Reverb search in background — doesn't block catalog results
      invokeEdgeFunction<SearchReverbResponse>('search-pedals', { query: safe }).then(({ data }) => {
        if (data?.results) {
          setRetireTradeReverbResults((data.results as ReverbResult[]).filter(r => !r.in_catalog));
        }
      }).catch(() => {});
      // Local catalog search
      try {
        const { data } = await invokeEdgeFunction<PedalSearchLocalResponse>('search-pedals', { query: safe, localOnly: true });
        setRetireTradeResults((data?.pedals as Pedal[]) ?? []);
      } catch { setRetireTradeResults([]); }
      setRetireTradeSearching(false);
    }, 350);
  };

  const handleSelectRetireTradeReverbResult = async (result: ReverbResult) => {
    Haptics.selectionAsync();
    setRetireTradeUpserting(true);
    const { data, error } = await invokeEdgeFunction<SearchUpsertResponse>('search-pedals', {
      action: 'upsert',
      brand: result.brand,
      model: result.model,
      category: result.category,
      avg_price: result.avg_price,
      image_url: result.photo_url ?? null,
    });
    setRetireTradeUpserting(false);
    if (!error && data?.pedal) {
      handleSelectRetireNewPedal(data.pedal as Pedal);
    }
  };

  const handleSelectRetireNewPedal = async (pedal: Pedal) => {
    Haptics.selectionAsync();
    setRetireNewPedal(pedal);
    setRetireTradeSearch('');
    setRetireTradeResults([]);
    setRetireTradeReverbResults([]);
    const { data } = await supabase
      .from('pedal_colorways')
      .select('*')
      .eq('pedal_id', pedal.id)
      .order('is_default', { ascending: false });
    const list = (data as PedalColorway[]) ?? [];
    setRetireNewColorways(list);
    const def = list.find(c => c.is_default);
    if (def) setRetireNewColorwayId(def.id);
  };

  const buildPedalChain = async (startPedal: UserPedal) => {
    setChainLoading(true);
    const chain: UserPedal[] = [startPedal];
    let current = startPedal;
    while (current.traded_from_user_pedal_id) {
      const { data } = await supabase
        .from('user_pedals')
        .select('*, pedal:pedals(*)')
        .eq('id', current.traded_from_user_pedal_id)
        .single();
      if (!data) break;
      chain.push(data as UserPedal);
      current = data as UserPedal;
    }
    chain.reverse();
    setPedalChain(chain);
    setChainLoading(false);
  };

  // Track keyboard visibility for closeDetail (same pattern as AddPedalModal)
  const detailKbVisibleRef = useRef(false);
  useEffect(() => {
    const s = Keyboard.addListener('keyboardWillShow', () => { detailKbVisibleRef.current = true; });
    const h = Keyboard.addListener('keyboardDidHide',  () => { detailKbVisibleRef.current = false; });
    return () => { s.remove(); h.remove(); };
  }, []);

  const closeDetail = () => {
    const doClose = () => {
      setShowDetailModal(false);
      setDetailPedal(null);
      setRetiredReason(null);
      setListingStatus(null);
      setAskingPrice('');
      navigation.setParams({ openPedalId: undefined });
    };

    if (detailKbVisibleRef.current) {
      Keyboard.dismiss();
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        hideSub.remove();
        clearTimeout(fallback);
        doClose();
      };
      const hideSub = Keyboard.addListener('keyboardDidHide', settle);
      const fallback = setTimeout(settle, 500);
    } else {
      doClose();
    }
  };

  const fetchWishlistListings = async (item: UserPedal, sort: 'newest' | 'price') => {
    const pedal = item.pedal;
    if (!pedal) return;
    setWishlistLoading(true);
    setWishlistError(null);
    try {
      const primaryQuery = `${pedal.brand} ${pedal.model}`.trim();
      const { data, error } = await invokeEdgeFunction<SearchListingsResponse>('search-pedals', {
        action: 'listings',
        query: primaryQuery,
        sort,
      });
      if (error) throw error;
      let listings = data?.listings ?? [];
      if (__DEV__ && (data as { _debug?: unknown } | null)?._debug) {
        console.warn('[Wishlist listings] debug:', (data as { _debug?: unknown })._debug);
      }
      // Fallback query when exact brand+model yields no results
      if (listings.length === 0) {
        const fallbackQuery = `${pedal.model}`.trim();
        const { data: fallbackData, error: fallbackErr } = await invokeEdgeFunction<SearchListingsResponse>('search-pedals', {
          action: 'listings',
          query: fallbackQuery,
          sort,
        });
        if (__DEV__ && (fallbackData as { _debug?: unknown } | null)?._debug) {
          console.warn('[Wishlist listings] fallback debug:', (fallbackData as { _debug?: unknown })._debug);
        }
        if (!fallbackErr) {
          listings = fallbackData?.listings ?? [];
        }
      }
      setWishlistListings(listings);
      if (listings.length === 0) {
        const primaryDebug = (data as { _debug?: { stage?: string; reverbStatus?: number; reverbError?: string; error?: string } } | null)?._debug;
        const stage = primaryDebug?.stage;
        if (stage) {
          // The edge function ran fine but the external marketplace API failed
          setWishlistError(classifyError(null, { externalApiStage: stage }));
        }
        // else: truly empty, no error — "No listings found right now." shown by default
      }

      // If this pedal has no image at all, kick off a quality-scored image fetch
      // in the background — uses pedal-image edge function which prefers official
      // brand shop photos over random user listing photos.
      if (!item.user_image_path && !pedal.image_url) {
        invokeEdgeFunction('pedal-image', {
          pedal_id: pedal.id,
          brand:    pedal.brand,
          model:    pedal.model,
        }).then(({ data }) => {
          const url = (data as { image_url?: string | null })?.image_url;
          if (url) {
            setDetailUserImageUrl(url);
            fetchPedals();
          }
        }).catch(() => {});
      }
    } catch (e) {
      const status = extractHttpStatus(e);
      if (__DEV__) console.warn('[Wishlist listings] error:', { msg: (e as Error)?.message, status });
      setWishlistError(classifyError(e, { httpStatus: status }));
    } finally {
      setWishlistLoading(false);
    }
  };

  const saveDetail = async () => {
    if (!detailPedal) return;
    setSavingDetails(true);
    const parsePrice = (value: string) => {
      const num = parseFloat(value);
      return Number.isFinite(num) ? num : null;
    };
    const today = new Date().toISOString().split('T')[0];
    const update: Record<string, unknown> = {
      acquired_date: acquiredDate.trim() ? toDbDate(acquiredDate.trim()) : null,
      acquired_method: acquiredMethod,
      purchase_price: acquiredMethod === 'purchase' ? parsePrice(acquiredPrice) : null,
      acquired_from: acquiredMethod === 'purchase' ? (acquiredFrom.trim() || null) : null,
      acquired_trade_for: acquiredMethod === 'trade' ? (acquiredTradeFor.trim() || null) : null,
      acquired_trade_with: acquiredMethod === 'trade' ? (acquiredTradeWith.trim() || null) : null,
      notes: acquiredNotes.trim() || null,
      condition: condition || null,
      serial_number: serialNumber.trim() || null,
      colorway_id: detailColorwayId ?? null,
      category_override: categoryOverride ?? null,
      // target_price only persisted for wishlist items
      ...(detailPedal.status === 'wishlist' && {
        target_price: parsePrice(targetPrice),
      }),
      // listing status — only for owned pedals, cleared on retire
      ...(detailPedal.status === 'owned' && !showRetireSection && {
        listing_status: listingStatus,
        asking_price: (listingStatus === 'for_sale' || listingStatus === 'for_sale_or_trade') ? parsePrice(askingPrice) : null,
        loaned_to: isOnLoan ? (loanedTo.trim() || null) : null,
      }),
      ...(showRetireSection && {
        listing_status: null,
        asking_price: null,
        loaned_to: null,
      }),
    };

    const retiredDateDb = retiredDate.trim() ? toDbDate(retiredDate.trim()) : today;
    const newPedalName = retireNewPedal
      ? `${retireNewPedal.brand} ${retireNewPedal.model}`
      : retiredTradeFor.trim() || null;

    if (detailPedal.status === 'retired' || showRetireSection) {
      Object.assign(update, {
        retired_date: retiredDate.trim() ? toDbDate(retiredDate.trim()) : (showRetireSection ? today : null),
        retired_method: retiredMethod,
        retired_price: retiredMethod === 'sale' ? parsePrice(retiredPrice) : null,
        retired_trade_for: retiredMethod === 'trade' ? newPedalName : null,
        retired_to: retiredTo.trim() || null,
        retired_notes: (() => {
          const notesWithReason = retiredReason
            ? `REASON: ${retiredReason}\n${retiredNotes.trim()}`.trim()
            : retiredNotes.trim() || null;
          return notesWithReason;
        })(),
      });
    }
    if (showRetireSection && detailPedal.status !== 'retired') {
      update.status = 'retired';
    }

    const { error } = await supabase
      .from('user_pedals')
      .update(update)
      .eq('id', detailPedal.id);

    if (error) {
      setSavingDetails(false);
      if (__DEV__) console.warn('[saveDetail] Supabase error:', error);
      const classified = classifyError(error, { httpStatus: extractHttpStatus(error) });
      const detail = (error as { message?: string })?.message;
      Alert.alert(classified.title, detail || classified.message);
      return;
    }

    // If retiring via trade and user selected the new pedal, insert it now
    if (showRetireSection && retiredMethod === 'trade' && retireNewPedal && session?.user) {
      const cashNum = retireCashPaid.trim() ? parseFloat(retireCashPaid.replace(/[^0-9.-]/g, '')) : null;
      const { error: insertError } = await supabase.from('user_pedals').insert({
        user_id: session.user.id,
        pedal_id: retireNewPedal.id,
        colorway_id: retireNewColorwayId ?? null,
        status: 'owned',
        acquired_method: 'trade',
        acquired_date: retiredDateDb,
        acquired_trade_for: detailPedal.pedal
          ? `${detailPedal.pedal.brand} ${detailPedal.pedal.model}`
          : null,
        acquired_trade_with: retiredTo.trim() || null,
        traded_from_user_pedal_id: detailPedal.id,
        trade_cash_paid: Number.isFinite(cashNum ?? NaN) ? cashNum : null,
        notes: retiredNotes.trim() || null,
      });
      if (insertError) {
        setSavingDetails(false);
        Alert.alert('Pedal retired but new pedal failed to add', insertError.message);
        fetchPedals();
        closeDetail();
        return;
      }
    }

    setSavingDetails(false);
    fetchPedals();
    refreshUserImages();
    closeDetail();
  };

  // Saved before closing the detail modal so doPickPhotoFromMain can use it.
  const photoPickRef = useRef<{ pedalId: string; userId: string; useCamera: boolean } | null>(null);

  // Close the detail modal FIRST so the picker has a clean VC stack,
  // then reopen after the photo is taken/uploaded.
  const handlePickPhoto = (useCamera: boolean) => {
    if (!detailPedal || !session?.user) return;
    photoPickRef.current = { pedalId: detailPedal.id, userId: session.user.id, useCamera };
    setShowDetailModal(false);
    setTimeout(() => doPickPhotoFromMain(), 400);
  };

  const handleOpenPhotoOptions = () => {
    if (!detailPedal) return;
    const hasUserPhoto = !!detailPedal.user_image_path;
    const options: { text: string; style?: 'default' | 'destructive' | 'cancel'; onPress?: () => void }[] = [
      { text: 'Take Photo', onPress: () => setTimeout(() => handlePickPhoto(true), 400) },
      { text: 'Photo Library', onPress: () => setTimeout(() => handlePickPhoto(false), 400) },
    ];
    if (hasUserPhoto) {
      options.push({
        text: 'Remove Photo',
        style: 'destructive',
        onPress: () => handleRemovePhoto(),
      });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Pedal Photo', undefined, options);
  };

  // Watch Demo — TPC channel video for this pedal if one exists, otherwise the
  // most-viewed YouTube demo. Fetched on tap (not on detail open) to conserve
  // YouTube API quota.
  const handleWatchDemo = async () => {
    if (!detailPedal?.pedal) return;
    const { brand, model } = detailPedal.pedal;
    Haptics.selectionAsync();
    setDemoLoading(true);
    try {
      const { data } = await invokeEdgeFunction<{ video: { id: string; title: string; isTpc: boolean } | null }>(
        'youtube-videos',
        { mode: 'demo', query: `${brand} ${model} pedal` },
      );
      if (data?.video?.id) {
        await Linking.openURL(`https://www.youtube.com/watch?v=${data.video.id}`);
      } else {
        // No API hit — fall back to a YouTube search in the browser
        await Linking.openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${brand} ${model} pedal demo`)}`);
      }
    } catch {
      Alert.alert('Could not load video', 'Please try again.');
    } finally {
      setDemoLoading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!detailPedal?.user_image_path) return;
    const pedalId = detailPedal.id;
    const oldPath = detailPedal.user_image_path;
    try {
      await supabase.from('user_pedals').update({ user_image_path: null }).eq('id', pedalId);
      // Best-effort delete of stored files
      const thumbPath = oldPath.replace(/\.jpg$/, '_sm.jpg');
      supabase.storage.from('user-pedal-photos').remove([oldPath, thumbPath]).catch(() => {});
      useStore.setState(s => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [pedalId]: _u, ...restUrls } = s.userImageUrls;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [pedalId]: _t, ...restThumbs } = s.userImageThumbUrls;
        return {
          userImageUrls: restUrls,
          userImageThumbUrls: restThumbs,
          ownedPedals: s.ownedPedals.map(p => p.id === pedalId ? { ...p, user_image_path: null } : p),
          wishlistPedals: s.wishlistPedals.map(p => p.id === pedalId ? { ...p, user_image_path: null } : p),
          retiredPedals: s.retiredPedals.map(p => p.id === pedalId ? { ...p, user_image_path: null } : p),
        };
      });
      setDetailUserImageUrl(null);
      setDetailImageFailed(false);
    } catch {
      Alert.alert('Could not remove photo', 'Please try again.');
    }
  };

  const doPickPhotoFromMain = useCallback(async () => {
    const ctx = photoPickRef.current;
    if (!ctx) return;
    const { pedalId, userId, useCamera } = ctx;
    photoPickRef.current = null;

    const reopenDetail = () => {
      const all = [
        ...useStore.getState().ownedPedals,
        ...useStore.getState().wishlistPedals,
        ...useStore.getState().retiredPedals,
      ];
      const found = all.find(p => p.id === pedalId);
      if (found) openDetail(found);
    };

    if (useCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow camera access to take a pedal photo.');
        reopenDetail();
        return;
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow photo library access to upload a pedal photo.');
        reopenDetail();
        return;
      }
    }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
          quality: 0.85,
        });
    if (result.canceled || !result.assets?.[0]?.uri) {
      reopenDetail();
      return;
    }
    setUploadingPhoto(true);
    try {
      const asset = result.assets[0];
      const basePath = `${userId}/pedals/${pedalId}/${Date.now()}`;
      const path = `${basePath}.jpg`;
      const thumbPath = `${basePath}_sm.jpg`;
      const [fullAsset, thumbAsset] = await Promise.all([
        ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 1400 } }],
          { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
        ),
        ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 360 } }],
          { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
        ),
      ]);
      // ArrayBuffer is required for Supabase storage uploads in React Native —
      // fetch().blob() returns a pseudo-Blob that doesn't serialize over the network.
      const [fullBuffer, thumbBuffer] = await Promise.all([
        fetch(fullAsset.uri).then(r => r.arrayBuffer()),
        fetch(thumbAsset.uri).then(r => r.arrayBuffer()),
      ]);
      const { error: uploadError } = await supabase.storage
        .from('user-pedal-photos')
        .upload(path, fullBuffer, {
          upsert: false,
          contentType: 'image/jpeg',
          cacheControl: '31536000',
        });
      if (uploadError) throw uploadError;
      const { error: uploadThumbError } = await supabase.storage
        .from('user-pedal-photos')
        .upload(thumbPath, thumbBuffer, {
          upsert: false,
          contentType: 'image/jpeg',
          cacheControl: '31536000',
        });
      if (uploadThumbError) throw uploadThumbError;

      const { error: updateError } = await supabase
        .from('user_pedals')
        .update({ user_image_path: path })
        .eq('id', pedalId);
      if (updateError) throw updateError;

      const [{ data: signed }, { data: signedThumb }] = await Promise.all([
        supabase.storage.from('user-pedal-photos').createSignedUrl(path, 60 * 60 * 24 * 7),
        supabase.storage.from('user-pedal-photos').createSignedUrl(thumbPath, 60 * 60 * 24 * 7),
      ]);
      const fullUrl = signed?.signedUrl ?? null;
      const thumbUrl = signedThumb?.signedUrl ?? fullUrl;
      if (fullUrl) {
        // Optimistically update store so the detail modal shows the new photo immediately
        useStore.setState(s => ({
          userImageUrls: { ...s.userImageUrls, [pedalId]: fullUrl },
          userImageThumbUrls: thumbUrl ? { ...s.userImageThumbUrls, [pedalId]: thumbUrl } : s.userImageThumbUrls,
          ownedPedals: s.ownedPedals.map(p => p.id === pedalId ? { ...p, user_image_path: path } : p),
          wishlistPedals: s.wishlistPedals.map(p => p.id === pedalId ? { ...p, user_image_path: path } : p),
          retiredPedals: s.retiredPedals.map(p => p.id === pedalId ? { ...p, user_image_path: path } : p),
        }));
      }
      refreshUserImages(); // non-blocking: updates persistent cache
      reopenDetail(); // reopen the detail modal with the updated pedal
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not upload photo. Please try again.';
      Alert.alert('Upload failed', message);
      reopenDetail();
    } finally {
      setUploadingPhoto(false);
    }
  }, [openDetail, refreshUserImages]);

  const handleRemovePedal = () => {
    if (!detailPedal) return;
    Alert.alert('Remove pedal?', 'This will remove it from your collection completely.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            if (!session?.user?.id) {
              Alert.alert('Session expired', 'Please sign in again.');
              return;
            }
            const { error, data: deleted } = await supabase
              .from('user_pedals')
              .delete()
              .eq('id', detailPedal.id)
              .eq('user_id', session.user.id)
              .select('id');
            if (error) {
              Alert.alert('Remove failed', error.message);
              return;
            }
            if (!deleted?.length) {
              Alert.alert('Remove failed', 'Could not confirm deletion for this account.');
              return;
            }
            useStore.setState((s) => ({
              ownedPedals: s.ownedPedals.filter((p) => p.id !== detailPedal.id),
              wishlistPedals: s.wishlistPedals.filter((p) => p.id !== detailPedal.id),
              retiredPedals: s.retiredPedals.filter((p) => p.id !== detailPedal.id),
            }));
            fetchPedals();
            closeDetail();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            Alert.alert('Remove failed', msg);
          }
        },
      },
    ]);
  };

  const openReassign = () => {
    setReassignQuery('');
    setReassignResults([]);
    setReassignReverbResults([]);
    setReassignSearching(false);
    setReassignSaving(false);
    setShowReassignModal(true);
  };

  const closeReassign = () => {
    setShowReassignModal(false);
    setReassignQuery('');
    setReassignResults([]);
    setReassignReverbResults([]);
  };

  const handleReassignSearch = (query: string) => {
    setReassignQuery(query);
    if (reassignDebounceRef.current) clearTimeout(reassignDebounceRef.current);
    if (!query.trim()) { setReassignResults([]); setReassignReverbResults([]); return; }
    reassignDebounceRef.current = setTimeout(async () => {
      const safe = query.replace(/[^a-zA-Z0-9 \-_.]/g, '').trim().slice(0, 100);
      if (!safe) { setReassignResults([]); setReassignReverbResults([]); return; }
      const searchId = ++reassignSearchIdRef.current;
      setReassignSearching(true);

      // Reverb search in background (same pattern as AddPedalModal)
      invokeEdgeFunction<{ results: ReverbResult[] }>('search-pedals', { query: safe }).then(({ data, error }) => {
        if (reassignSearchIdRef.current !== searchId || error) return;
        const all = (data?.results ?? []) as ReverbResult[];
        setReassignReverbResults(all.filter(r => !r.in_catalog));
      }).catch(() => {});

      // Catalog search
      try {
        const { data } = await invokeEdgeFunction<{ pedals: Pedal[] }>('search-pedals', { query: safe, localOnly: true });
        if (reassignSearchIdRef.current !== searchId) return;
        setReassignResults((data?.pedals ?? []) as Pedal[]);
      } catch {
        if (reassignSearchIdRef.current === searchId) setReassignResults([]);
      }
      if (reassignSearchIdRef.current === searchId) setReassignSearching(false);
    }, 350);
  };

  const handleReassignSelectReverb = async (result: ReverbResult) => {
    setReassignSaving(true);
    const { data, error } = await invokeEdgeFunction<{ pedal?: Pedal }>('search-pedals', {
      action: 'upsert',
      brand: result.brand,
      model: result.model,
      category: result.category,
      avg_price: result.avg_price,
      image_url: result.photo_url ?? null,
    });
    if (error || !data?.pedal) {
      setReassignSaving(false);
      Alert.alert('Error', 'Could not add this pedal to the catalog.');
      return;
    }
    await handleReassignPedal(data.pedal as Pedal);
  };

  const handleReassignPedal = async (newPedal: Pedal) => {
    if (!detailPedal) return;
    setReassignSaving(true);
    const { error } = await supabase
      .from('user_pedals')
      .update({ pedal_id: newPedal.id })
      .eq('id', detailPedal.id);
    setReassignSaving(false);
    if (error) {
      Alert.alert('Reassign failed', error.message);
      return;
    }
    closeReassign();
    fetchPedals();
  };

  const handleWishlistLongPress = (item: UserPedal) => {
    if (item.status !== 'wishlist') return;
    Alert.alert('Remove from GAS list?', 'This will remove it from your GAS list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            if (!session?.user?.id) {
              Alert.alert('Session expired', 'Please sign in again.');
              return;
            }
            const { error, data: deleted } = await supabase
              .from('user_pedals')
              .delete()
              .eq('id', item.id)
              .eq('user_id', session.user.id)
              .select('id');
            if (error) {
              Alert.alert('Remove failed', error.message);
              return;
            }
            if (!deleted?.length) {
              Alert.alert('Remove failed', 'Could not confirm deletion for this account.');
              return;
            }
            useStore.setState((s) => ({
              wishlistPedals: s.wishlistPedals.filter((p) => p.id !== item.id),
              ownedPedals: s.ownedPedals.filter((p) => p.id !== item.id),
              retiredPedals: s.retiredPedals.filter((p) => p.id !== item.id),
            }));
            fetchPedals();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            Alert.alert('Remove failed', msg);
          }
        },
      },
    ]);
  };

  // ── Unretire — move a previously retired pedal back to owned ─────────────────
  const handleUnretirePedal = async (item: UserPedal) => {
    if (!session?.user?.id) {
      Alert.alert('Session expired', 'Please sign in again.');
      return;
    }
    const { error } = await supabase
      .from('user_pedals')
      .update({
        status: 'owned',
        retired_date: null,
        retired_method: null,
        retired_price: null,
        retired_trade_for: null,
        retired_to: null,
        retired_notes: null,
        listing_status: null,
        asking_price: null,
      })
      .eq('id', item.id)
      .eq('user_id', session.user.id);

    if (error) {
      Alert.alert('Unretire failed', error.message);
      return;
    }

    const restored: UserPedal = {
      ...item,
      status: 'owned',
      retired_date: null,
      retired_method: null,
      retired_price: null,
      retired_trade_for: null,
      retired_to: null,
      retired_notes: null,
      listing_status: null,
      asking_price: null,
    };

    useStore.setState((s) => ({
      retiredPedals: s.retiredPedals.filter((p) => p.id !== item.id),
      ownedPedals: [restored, ...s.ownedPedals],
    }));

    // Close detail panel if this pedal was open in it
    if (detailPedal?.id === item.id) closeDetail();

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleRetiredLongPress = (item: UserPedal) => {
    if (item.status !== 'retired') return;
    Alert.alert(
      item.pedal ? `${item.pedal.brand} ${item.pedal.model}` : 'Retired pedal',
      'What would you like to do?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Got it back — move to Owned',
          onPress: () => handleUnretirePedal(item),
        },
        {
          text: 'Delete from history',
          style: 'destructive',
          onPress: async () => {
            try {
              if (!session?.user?.id) {
                Alert.alert('Session expired', 'Please sign in again.');
                return;
              }
              const { error, data: deleted } = await supabase
                .from('user_pedals')
                .delete()
                .eq('id', item.id)
                .eq('user_id', session.user.id)
                .select('id');
              if (error) {
                Alert.alert('Delete failed', error.message);
                return;
              }
              if (!deleted?.length) {
                Alert.alert('Delete failed', 'Could not confirm deletion for this account.');
                return;
              }
              useStore.setState((s) => ({
                retiredPedals: s.retiredPedals.filter((p) => p.id !== item.id),
                ownedPedals: s.ownedPedals.filter((p) => p.id !== item.id),
                wishlistPedals: s.wishlistPedals.filter((p) => p.id !== item.id),
              }));
              fetchPedals();
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              Alert.alert('Delete failed', msg);
            }
          },
        },
      ]
    );
  };



  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <LinearGradient colors={gradients.header} style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle}>Vault</Text>
          {totalInvested > 0 && !wifeMode && (
            <View style={styles.valueRow}>
              <View style={styles.valuePair}>
                <Text style={styles.valueLabel}>Invested</Text>
                <Text style={styles.valueAmount}>
                  {fmt(totalInvested)}
                </Text>
              </View>
              {totalMarketValue > 0 && !wifeMode && (
                <>
                  <Text style={styles.valueDot}>•</Text>
                  <View style={styles.valuePair}>
                    <Text style={styles.valueLabel}>Est. Value</Text>
                    <Text style={styles.valueAmount}>
                      {fmt(totalMarketValue)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.valueDeltaPill,
                      { backgroundColor: (totalMarketValue >= totalInvested ? colors.teal : colors.rose) + '1A' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.valueDeltaText,
                        { color: totalMarketValue >= totalInvested ? colors.teal : colors.rose },
                      ]}
                    >
                      {fmtDelta(totalMarketValue - totalInvested)}
                    </Text>
                  </View>
                </>
              )}
            </View>
          )}
        </View>

        {/* Owned / GAS / FS/FT tabs */}
        <View style={styles.tabs}>
          {(['owned', 'wishlist', 'listed'] as const).map(tab => {
            const label = tab === 'owned' ? 'Owned' : tab === 'wishlist' ? 'GAS' : 'FS/FT';
            const icon: keyof typeof Ionicons.glyphMap = tab === 'owned' ? 'cube-outline' : tab === 'wishlist' ? 'flame-outline' : 'pricetag-outline';
            const count = tab === 'owned' ? ownedPedals.length : tab === 'wishlist' ? wishlistPedals.length : listedPedals.length;
            const isActive = activeTab === tab;
            const gradColors: [string, string] =
              tab === 'wishlist' ? [colors.rose, colors.roseDark] :
              tab === 'listed'   ? [colors.gold, colors.goldDark] :
              [gradients.teal[0], gradients.teal[1]];
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => handleTabPress(tab)}
                activeOpacity={0.75}
              >
                {isActive ? (
                  <>
                    <LinearGradient
                      colors={gradColors}
                      style={StyleSheet.absoluteFillObject}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    />
                    <View style={styles.tabGradientContent}>
                      <Text style={styles.tabTextActive}>{label}</Text>
                      <View style={styles.tabBadge}>
                        <Text style={styles.tabBadgeText}>{count}</Text>
                      </View>
                    </View>
                  </>
                ) : (
                  <View style={styles.tabInner}>
                    <Ionicons name={icon} size={13} color={colors.textMuted} />
                    <Text style={styles.tabText}>{label}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Search bar */}
        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={activeTab === 'owned' ? 'Search owned pedals...' : activeTab === 'wishlist' ? 'Search GAS list...' : 'Search FS/FT listings...'}
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Category filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <TouchableOpacity
            style={[styles.chip, activeCategory === null && styles.chipActive]}
            onPress={() => { Haptics.selectionAsync(); setActiveCategory(null); }}
          >
            <Text style={[styles.chipText, activeCategory === null && styles.chipTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.chip, activeCategory === cat && styles.chipActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setActiveCategory(activeCategory === cat ? null : cat);
              }}
            >
              <Text style={[styles.chipText, activeCategory === cat && styles.chipTextActive]}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </LinearGradient>

      {/* ── Action Bar ── */}
      <View style={styles.actionBarWrap}>
        <LinearGradient
          colors={['#F7F4F0', '#F7F4F0', 'rgba(247,244,240,0)']}
          style={styles.actionBarFade}
          pointerEvents="none"
        />
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={styles.actionFull}
            activeOpacity={0.85}
            disabled={isScanningMain}
            onPress={handleAddPedalPress}
          >
            <LinearGradient
              colors={
                activeTab === 'wishlist' ? [colors.rose, colors.roseDark] :
                activeTab === 'listed'   ? [colors.gold, colors.goldDark] :
                gradients.teal
              }
              style={styles.actionFullCard}
            >
              {isScanningMain
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="camera-outline" size={20} color="#fff" />
              }
              <Text style={styles.actionHalfTitle}>
                {isScanningMain ? 'Identifying…' : 'Add a Pedal'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Share strip — collection (owned tab) ── */}
      {activeTab === 'owned' && collectionAllPedals.length > 0 && (
        <TouchableOpacity
          style={styles.shareCollectionRow}
          activeOpacity={0.75}
          onPress={handleShareCollection}
        >
          <Ionicons name="share-outline" size={15} color={colors.teal} />
          <Text style={styles.shareCollectionText}>Share My Collection</Text>
          <Text style={styles.shareGasListCount}>({collectionAllPedals.length})</Text>
          <Ionicons name="chevron-forward" size={13} color={colors.teal + '80'} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
      )}

      {/* ── Share GAS List strip — visible only when wishlist tab has items ── */}
      {activeTab === 'wishlist' && wishlistPedals.length > 0 && (
        <TouchableOpacity
          style={[styles.shareCollectionRow, { backgroundColor: colors.rose + '0F', borderColor: colors.rose + '28' }]}
          activeOpacity={0.75}
          onPress={handleShareGasCard}
          onLongPress={() => setGasListShareOpen(true)}
        >
          <Ionicons name="share-outline" size={15} color={colors.rose} />
          <Text style={[styles.shareCollectionText, { color: colors.rose }]}>Share My GAS List</Text>
          <Text style={styles.shareGasListCount}>({wishlistPedals.length})</Text>
          <Ionicons name="chevron-forward" size={13} color={colors.rose + '80'} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
      )}

      {/* ── Share strip — FS/FT tab (opens config pre-filtered to FS/FT only) ── */}
      {activeTab === 'listed' && listedPedals.length > 0 && (
        <TouchableOpacity
          style={[styles.shareCollectionRow, { backgroundColor: colors.gold + '18', borderColor: colors.gold + '40' }]}
          activeOpacity={0.75}
          onPress={() => {
            Haptics.selectionAsync();
            setShareFsftOnly(true);
            setSharePriceMode('asking');
            setShareSelCategories([]);
            setShareSort('newest');
            setCollectionPage(0);
            setShareConfigOpen(true);
          }}
        >
          <Ionicons name="share-outline" size={15} color={colors.goldDark} />
          <Text style={[styles.shareCollectionText, { color: colors.goldDark }]}>Share My FS/FT List</Text>
          <Text style={[styles.shareGasListCount, { color: colors.gold + 'AA' }]}>({listedPedals.length})</Text>
          <Ionicons name="chevron-forward" size={13} color={colors.gold + '80'} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
      )}
      {(() => {
        const gasPedals = wishlistPedals
          .filter(p => p.pedal?.brand && p.pedal?.model)
          .map(p => ({ brand: p.pedal!.brand, model: p.pedal!.model }));
        const shown = gasPedals.slice(0, 8).map(p => `• ${p.brand} ${p.model}`);
        if (gasPedals.length > 8) shown.push(`+${gasPedals.length - 8} more`);
        const gasListText = [
          'My GAS List 🔥',
          '',
          ...shown,
          '',
          `${gasPedals.length} pedal${gasPedals.length !== 1 ? 's' : ''} on my radar. Track yours on TPC — https://thepedalcollaborative.com`,
          '',
          '#guitarpedals #GAS #pedalNGD #tonehunter',
        ].join('\n');
        return (
          <SocialShareSheet
            visible={gasListShareOpen}
            onClose={() => setGasListShareOpen(false)}
            text={gasListText}
            xText={`${gasPedals.length} pedals on my GAS list 🔥 #guitarpedals #GAS`}
          />
        );
      })()}
      {(() => {
        const fsftPedals: FsftPedal[] = listedPedals
          .filter(p => p.pedal?.brand && p.pedal?.model && p.listing_status)
          .map(p => ({
            brand: p.pedal!.brand,
            model: p.pedal!.model,
            listing_status: p.listing_status!,
            asking_price: p.asking_price ?? null,
          }));
        const lines: string[] = [];
        for (const p of fsftPedals.slice(0, 10)) {
          let line = `• ${p.brand} ${p.model}`;
          if (p.listing_status === 'for_sale' || p.listing_status === 'for_sale_or_trade') {
            line += p.asking_price != null ? ` — $${p.asking_price}` : ' — FS';
          }
          if (p.listing_status === 'for_trade' || p.listing_status === 'for_sale_or_trade') {
            line += ' — FT';
          }
          lines.push(line);
        }
        if (fsftPedals.length > 10) lines.push(`+${fsftPedals.length - 10} more`);
        const hasFS = fsftPedals.some(p => p.listing_status !== 'for_trade');
        const hasFT = fsftPedals.some(p => p.listing_status !== 'for_sale');
        const headline = hasFS && hasFT ? 'Pedals For Sale & Trade 🎸' : hasFS ? 'Pedals For Sale 💰' : 'Pedals For Trade 🔄';
        const fsftText = [
          headline, '',
          ...lines, '',
          `${fsftPedals.length} pedal${fsftPedals.length !== 1 ? 's' : ''} available. DMs open — tracked on TPC — https://thepedalcollaborative.com`,
          '',
          '#guitarpedals #pedalboard #FS #FT #geartrade',
        ].join('\n');
        return (
          <SocialShareSheet
            visible={fsftShareOpen}
            onClose={() => setFsftShareOpen(false)}
            text={fsftText}
            xText={`${fsftPedals.length} pedal${fsftPedals.length !== 1 ? 's' : ''} FS/FT — DMs open 🎸 #guitarpedals #geartrade`}
          />
        );
      })()}

      {/* ── List ── */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <PedalCard
            userPedal={item}
            retired={item.status === 'retired'}
            marketValue={marketValues[item.pedal_id]}
            imageUrlOverride={userImageThumbUrls[item.id] ?? userImageUrls[item.id]}
            viewMode={viewMode}
            boardColors={boardColorsByPedalId[item.pedal_id]}
            onPress={() => openDetail(item)}
            onLongPress={
              item.status === 'wishlist'
                ? () => handleWishlistLongPress(item)
                : item.status === 'retired'
                ? () => handleRetiredLongPress(item)
                : undefined
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon={activeTab === 'owned' ? 'cube-outline' : activeTab === 'wishlist' ? 'flame-outline' : 'pricetag-outline'}
            title={
              searchQuery || activeCategory
                ? 'No matches found'
                : activeTab === 'owned'
                ? 'No pedals owned yet'
                : activeTab === 'wishlist'
                ? 'GAS list is empty'
                : 'Nothing listed yet'
            }
            subtitle={
              searchQuery || activeCategory
                ? 'Try adjusting your search or filter'
                : activeTab === 'owned'
                ? 'Tap + to add your first pedal'
                : activeTab === 'wishlist'
                ? 'Tap + to start building your dream list'
                : 'Open a pedal you own and mark it For Sale or For Trade'
            }
            action={!searchQuery && !activeCategory && activeTab !== 'listed' ? 'Add Pedal' : undefined}
            onAction={() => setShowAddModal(true)}
          />
        }
      />

      {/* ── FAB removed (use action bar) ── */}

      {/* ── Add Pedal Modal ── */}
      <AddPedalModal
        visible={showAddModal}
        onClose={() => { setShowAddModal(false); setScanInitialSearch(null); setScanOpenManual(false); }}
        onAdded={(brand, model, isOwned) => {
          setShowAddModal(false);
          setScanInitialSearch(null);
          setScanOpenManual(false);
          fetchPedals();
          if (isOwned && brand && model) showShareNudge(brand, model);
        }}
        session={session}
        defaultTab={activeTab}
        initialSearch={scanInitialSearch}
        openManual={scanOpenManual}
      />

      {/* ── Pedal Detail Modal ── */}
      <Modal
        visible={showDetailModal}
        transparent
        animationType="slide"
        onRequestClose={closeDetail}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={undefined}
        >
          <TouchableOpacity style={styles.modalBackdrop} onPress={closeDetail} activeOpacity={1} />
          <SwipeDismissSheet style={styles.modalSheet} onDismiss={closeDetail}>
            <TouchableOpacity onPress={closeDetail} activeOpacity={0.7} style={styles.modalCloseBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </TouchableOpacity>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {detailPedal?.pedal ? `${detailPedal.pedal.brand} ${detailPedal.pedal.model}` : 'Edit Pedal'}
              </Text>
            </View>

            <KeyboardAwareScrollView
              innerRef={(ref) => { (detailScrollRef as any).current = ref; }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.detailContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              extraScrollHeight={24}
              enableOnAndroid
            >
              <>
                  {detailPedal?.status === 'wishlist' ? (
                    <>
                      {/* ── Price alert target ── */}
                      <View style={styles.targetPriceRow}>
                        <View style={styles.targetPriceLeft}>
                          <Ionicons name="notifications-outline" size={14} color={colors.teal} />
                          <Text style={styles.targetPriceLabel}>Alert me when below</Text>
                        </View>
                        <View style={styles.targetPriceInputWrap}>
                          <Text style={styles.targetPriceCurrency}>$</Text>
                          <TextInput
                            ref={targetPriceInputRef}
                            style={styles.targetPriceInput}
                            placeholder="—"
                            placeholderTextColor={colors.textMuted}
                            keyboardType="decimal-pad"
                            returnKeyType="done"
                            value={targetPrice}
                            onChangeText={setTargetPrice}
                            inputAccessoryViewID={Platform.OS === 'ios' ? targetPriceAccessoryId : undefined}
                            maxLength={7}
                          />
                        </View>
                      </View>
                      {Platform.OS === 'ios' && (
                        <InputAccessoryView nativeID={targetPriceAccessoryId}>
                          <View style={styles.keyboardAccessory}>
                            <TouchableOpacity
                              onPress={() => {
                                targetPriceInputRef.current?.blur();
                                Keyboard.dismiss();
                              }}
                              activeOpacity={0.75}
                              style={styles.keyboardAccessoryButton}
                            >
                              <Text style={styles.keyboardAccessoryButtonText}>Save</Text>
                            </TouchableOpacity>
                          </View>
                        </InputAccessoryView>
                      )}

                      <View style={styles.wishlistHeaderRow}>
                        <Text style={styles.sectionLabel}>REVERB LISTINGS</Text>
                        <View style={styles.sortRow}>
                          {(['newest', 'price'] as const).map(opt => (
                            <TouchableOpacity
                              key={opt}
                              style={[styles.sortChip, wishlistSort === opt && styles.sortChipActive]}
                              onPress={() => {
                                Haptics.selectionAsync();
                                setWishlistSort(opt);
                                if (detailPedal) fetchWishlistListings(detailPedal, opt);
                              }}
                              activeOpacity={0.8}
                            >
                              <Text style={[styles.sortChipText, wishlistSort === opt && styles.sortChipTextActive]}>
                                {opt === 'newest' ? 'Newest' : 'Price'}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {wishlistLoading ? (
                        <View style={styles.wishlistLoading}>
                          <ActivityIndicator color={colors.teal} />
                          <Text style={styles.helperText}>Loading listings…</Text>
                        </View>
                      ) : wishlistError ? (
                        <NetworkErrorView
                          error={wishlistError}
                          compact
                          onRetry={() => {
                            if (detailPedal) fetchWishlistListings(detailPedal, wishlistSort);
                          }}
                        />
                      ) : wishlistListings.length === 0 ? (
                        <Text style={styles.helperText}>No listings found right now.</Text>
                      ) : (() => {
                        const searchQuery = `${detailPedal?.pedal?.brand ?? ''} ${detailPedal?.pedal?.model ?? ''}`.trim();
                        const openSearch = () => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          Linking.openURL(reverbSearchUrl(searchQuery));
                        };
                        const prices = wishlistListings
                          .map(l => l.price)
                          .filter((p): p is number => p != null);
                        const fmt = (n: number) =>
                          new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
                        const minP = prices.length ? Math.min(...prices) : null;
                        const maxP = prices.length ? Math.max(...prices) : null;
                        const avgP = prices.length
                          ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
                          : null;
                        return (
                          <>
                            {/* ── Market summary card ── */}
                            <TouchableOpacity
                              style={styles.reverbSummaryCard}
                              activeOpacity={0.8}
                              onPress={openSearch}
                            >
                              <View>
                                <Text style={styles.reverbSummaryCount}>
                                  {wishlistListings.length} listing{wishlistListings.length !== 1 ? 's' : ''} available
                                </Text>
                                {minP != null && maxP != null && (
                                  <Text style={styles.reverbSummaryRange}>
                                    {minP === maxP ? fmt(minP) : `${fmt(minP)} – ${fmt(maxP)}`}
                                    {avgP != null ? `  ·  avg ${fmt(avgP)}` : ''}
                                  </Text>
                                )}
                              </View>
                              <Text style={styles.reverbSummaryCTA}>Shop on Reverb →</Text>
                            </TouchableOpacity>

                            {/* ── Individual listings (tap → search) ── */}
                            <View style={styles.wishlistList}>
                              {wishlistListings.map((l, idx) => (
                                <TouchableOpacity
                                  key={`${l.title}-${idx}`}
                                  style={styles.wishlistRow}
                                  activeOpacity={0.8}
                                  // Specific listing → Awin-wrapped direct link (higher conversion
                                  // than dumping the user on a search page). Fallback: search.
                                  onPress={() => l.url ? Linking.openURL(reverbAffiliateUrl(l.url)) : openSearch()}
                                >
                                  <View style={styles.wishlistTextBlock}>
                                    <Text style={styles.wishlistTitle} numberOfLines={2}>{l.title}</Text>
                                  </View>
                                  <Text style={styles.wishlistPrice}>
                                    {l.price != null ? fmt(l.price) : '—'}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      {/* ── Gear Journey Card (retired pedals only) ── */}
                      {detailPedal?.status === 'retired' && (() => {
                        const paid = detailPedal.purchase_price;
                        const sold = detailPedal.retired_price;
                        const net = (paid != null && sold != null) ? sold - paid : null;
                        const fromDate = detailPedal.acquired_date;
                        const toDate = detailPedal.retired_date;
                        const tenure = (() => {
                          if (!fromDate) return null;
                          const from = new Date(fromDate);
                          const to = toDate ? new Date(toDate) : new Date();
                          const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
                          if (months < 1) return 'Less than a month';
                          if (months < 12) return `${months} month${months !== 1 ? 's' : ''}`;
                          const years = Math.floor(months / 12);
                          const rem = months % 12;
                          return rem > 0 ? `${years}y ${rem}mo` : `${years} year${years !== 1 ? 's' : ''}`;
                        })();
                        const methodLabel = detailPedal.retired_method === 'sale'
                          ? detailPedal.retired_to ? `Sold to ${detailPedal.retired_to}` : 'Sold'
                          : detailPedal.retired_to ? `Traded with ${detailPedal.retired_to}` : detailPedal.retired_method === 'trade' ? 'Traded' : null;
                        return (
                          <View style={styles.gearJourneyCard}>
                            {tenure && (
                              <View style={styles.gearJourneyRow}>
                                <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                                <Text style={styles.gearJourneyMeta}>
                                  Owned for <Text style={styles.gearJourneyValue}>{tenure}</Text>
                                </Text>
                              </View>
                            )}
                            {methodLabel && (
                              <View style={styles.gearJourneyRow}>
                                <Ionicons name="swap-horizontal-outline" size={14} color={colors.textMuted} />
                                <Text style={styles.gearJourneyMeta}>{methodLabel}</Text>
                              </View>
                            )}
                            {(paid != null || sold != null) && (
                              <View style={styles.gearJourneyPL}>
                                {paid != null && (
                                  <View style={styles.gearJourneyPLItem}>
                                    <Text style={styles.gearJourneyPLLabel}>Paid</Text>
                                    <Text style={styles.gearJourneyPLAmount}>{fmt(paid)}</Text>
                                  </View>
                                )}
                                {paid != null && sold != null && (
                                  <Ionicons name="arrow-forward" size={13} color={colors.textMuted} />
                                )}
                                {sold != null && (
                                  <View style={styles.gearJourneyPLItem}>
                                    <Text style={styles.gearJourneyPLLabel}>
                                      {detailPedal.retired_method === 'trade' ? 'Traded for' : 'Sold for'}
                                    </Text>
                                    <Text style={styles.gearJourneyPLAmount}>{fmt(sold)}</Text>
                                  </View>
                                )}
                                {net !== null && (
                                  <View style={[styles.gearJourneyNetBadge, {
                                    backgroundColor: net >= 0 ? colors.teal + '20' : colors.rose + '20',
                                  }]}>
                                    <Text style={[styles.gearJourneyNetText, {
                                      color: net >= 0 ? colors.teal : colors.rose,
                                    }]}>
                                      {fmtDelta(net)}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            )}
                          </View>
                        );
                      })()}

                      <View style={styles.detailImageRow}>
                {(() => {
                  const colorwayImg = detailColorwayId
                    ? detailColorways.find(cw => cw.id === detailColorwayId)?.image_url ?? null
                    : null;
                  const effectiveImg = (detailUserImageUrl && !detailImageFailed)
                    ? detailUserImageUrl
                    : colorwayImg ?? detailPedal?.pedal?.image_url ?? null;
                  return effectiveImg ? (
                    <Image
                      source={{ uri: effectiveImg }}
                      style={styles.detailImage}
                      onError={() => { if (effectiveImg === detailUserImageUrl) setDetailImageFailed(true); }}
                    />
                  ) : (
                    <View style={styles.detailImageFallback}>
                      <Ionicons name="image-outline" size={22} color={colors.textMuted} />
                      <Text style={styles.detailImageFallbackText}>No photo</Text>
                    </View>
                  );
                })()}
                  <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    <TouchableOpacity
                      style={styles.detailPhotoBtn}
                      onPress={handleOpenPhotoOptions}
                      activeOpacity={0.8}
                      disabled={uploadingPhoto}
                    >
                      {uploadingPhoto ? (
                        <ActivityIndicator color={colors.teal} />
                      ) : (
                        <>
                          <Ionicons name="camera-outline" size={18} color={colors.teal} />
                          <Text style={styles.detailPhotoBtnText}>
                            {detailPedal?.user_image_path ? 'Change Photo' : 'Add Photo'}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.detailPhotoBtn}
                      onPress={handleWatchDemo}
                      activeOpacity={0.8}
                      disabled={demoLoading}
                    >
                      {demoLoading ? (
                        <ActivityIndicator color={colors.teal} />
                      ) : (
                        <>
                          <Ionicons name="logo-youtube" size={18} color={colors.teal} />
                          <Text style={styles.detailPhotoBtnText}>Watch Demo</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
              </View>

              {detailPedal?.status === 'owned' && !showRetireSection && (
                <>
                  <Text style={styles.sectionLabel}>Current Status</Text>

                  {/* Three status pills */}
                  <View style={styles.statusPillRow}>
                    {/* FS/FT pill */}
                    <TouchableOpacity
                      style={[styles.statusPill, listingStatus !== null && styles.statusPillActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        if (listingStatus !== null) {
                          setListingStatus(null);
                        } else {
                          setListingStatus('for_sale');
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="pricetag-outline"
                        size={13}
                        color={listingStatus !== null ? colors.teal : colors.textMuted}
                      />
                      <Text style={[styles.statusPillText, listingStatus !== null && styles.statusPillTextActive]}>
                        FS/FT
                      </Text>
                    </TouchableOpacity>

                    {/* On Loan pill */}
                    <TouchableOpacity
                      style={[styles.statusPill, isOnLoan && styles.statusPillActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setIsOnLoan(prev => !prev);
                        if (isOnLoan) setLoanedTo('');
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="swap-horizontal-outline"
                        size={13}
                        color={isOnLoan ? colors.teal : colors.textMuted}
                      />
                      <Text style={[styles.statusPillText, isOnLoan && styles.statusPillTextActive]}>
                        On Loan
                      </Text>
                    </TouchableOpacity>

                    {/* On Board pill — read-only, auto from board tab */}
                    <View style={[styles.statusPill, detailBoard !== null && styles.statusPillActive, styles.statusPillReadOnly]}>
                      <View
                        style={[
                          styles.statusPillBoardDot,
                          { backgroundColor: detailBoard ? (boardColorMap[detailBoard.color ?? 'teal'] ?? colors.teal) : colors.textMuted },
                        ]}
                      />
                      <Text style={[styles.statusPillText, detailBoard !== null && styles.statusPillTextActive]}>
                        On Board
                      </Text>
                    </View>
                  </View>

                  {/* FS/FT sub-section */}
                  {listingStatus !== null && (
                    <View style={styles.statusSubSection}>
                      <View style={styles.segmentedRow}>
                        {(['for_sale', 'for_trade', 'for_sale_or_trade'] as const).map(opt => (
                          <TouchableOpacity
                            key={opt}
                            style={[styles.segmentedButton, listingStatus === opt && styles.segmentedButtonActive]}
                            onPress={() => { Haptics.selectionAsync(); setListingStatus(opt); }}
                          >
                            <Text style={[styles.segmentedText, listingStatus === opt && styles.segmentedTextActive]}>
                              {opt === 'for_sale' ? 'For Sale' : opt === 'for_trade' ? 'For Trade' : 'FS+FT'}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {(listingStatus === 'for_sale' || listingStatus === 'for_sale_or_trade') && (
                        <TextInput
                          style={[styles.detailInput, { marginTop: spacing.sm }]}
                          placeholder="Asking price"
                          keyboardType="decimal-pad"
                          value={askingPrice}
                          onChangeText={setAskingPrice}
                          placeholderTextColor={colors.textMuted}
                        />
                      )}
                    </View>
                  )}

                  {/* On Loan sub-section */}
                  {isOnLoan && (
                    <View style={styles.statusSubSection}>
                      <TextInput
                        style={styles.detailInput}
                        placeholder="Who has it?"
                        value={loanedTo}
                        onChangeText={setLoanedTo}
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="words"
                      />
                    </View>
                  )}

                  {/* On Board info (read-only, shown when on a board) */}
                  {detailBoard !== null && (
                    <View style={styles.statusSubSection}>
                      <View style={styles.boardStatusValue}>
                        <View
                          style={[
                            styles.boardStatusDot,
                            { backgroundColor: boardColorMap[detailBoard.color ?? 'teal'] ?? colors.teal },
                          ]}
                        />
                        <Text style={styles.boardStatusText}>{detailBoard.name}</Text>
                      </View>
                    </View>
                  )}
                </>
              )}

              <Text style={styles.sectionLabel}>Acquisition</Text>

              <Text style={styles.fieldLabel}>Date acquired</Text>
              <DateField value={acquiredDate} onChange={setAcquiredDate} />

              <View style={styles.segmentedRow}>
                <TouchableOpacity
                  style={[styles.segmentedButton, acquiredMethod === 'purchase' && styles.segmentedButtonActive]}
                  onPress={() => setAcquiredMethod('purchase')}
                >
                  <Text style={[styles.segmentedText, acquiredMethod === 'purchase' && styles.segmentedTextActive]}>
                    Purchased
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segmentedButton, acquiredMethod === 'trade' && styles.segmentedButtonActive]}
                  onPress={() => setAcquiredMethod('trade')}
                >
                  <Text style={[styles.segmentedText, acquiredMethod === 'trade' && styles.segmentedTextActive]}>
                    Traded
                  </Text>
                </TouchableOpacity>
              </View>

              {acquiredMethod === 'purchase' ? (
                <>
                  <Text style={styles.fieldLabel}>Purchase price</Text>
                  <TextInput
                    style={styles.detailInput}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    value={acquiredPrice}
                    onChangeText={setAcquiredPrice}
                  />
                  <Text style={styles.fieldLabel}>Where purchased</Text>
                  <TextInput
                    style={styles.detailInput}
                    placeholder="Store or seller"
                    placeholderTextColor={colors.textMuted}
                    value={acquiredFrom}
                    onChangeText={setAcquiredFrom}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Traded for</Text>
                  <TextInput
                    style={styles.detailInput}
                    placeholder="What you traded"
                    placeholderTextColor={colors.textMuted}
                    value={acquiredTradeFor}
                    onChangeText={setAcquiredTradeFor}
                  />
                  <Text style={styles.fieldLabel}>Traded with</Text>
                  <TextInput
                    style={styles.detailInput}
                    placeholder="Who you traded with"
                    placeholderTextColor={colors.textMuted}
                    value={acquiredTradeWith}
                    onChangeText={setAcquiredTradeWith}
                  />
                </>
              )}

              <Text style={styles.fieldLabel}>Condition</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.conditionRow}
              >
                {CONDITIONS.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.conditionChip, condition === c && styles.conditionChipSelected]}
                    onPress={() => setCondition(prev => prev === c ? '' : c)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.conditionChipText, condition === c && styles.conditionChipTextSelected]}>
                      {c}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>Colorway</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.colorwayList}
              >
                {/* Standard = no colorway, use primary image */}
                <TouchableOpacity
                  style={[styles.colorwayChip, detailColorwayId === null && styles.colorwayChipSelected]}
                  onPress={() => setDetailColorwayId(null)}
                >
                  {detailPedal?.pedal?.image_url ? (
                    <Image source={{ uri: detailPedal.pedal.image_url }} style={styles.colorwaySwatch} resizeMode="cover" />
                  ) : null}
                  <Text style={[styles.colorwayChipText, detailColorwayId === null && styles.colorwayChipTextSelected]}>
                    Standard
                  </Text>
                </TouchableOpacity>
                {detailColorways.map(cw => {
                  const isSelected = detailColorwayId === cw.id;
                  return (
                    <TouchableOpacity
                      key={cw.id}
                      style={[styles.colorwayChip, isSelected && styles.colorwayChipSelected]}
                      onPress={() => setDetailColorwayId(cw.id)}
                    >
                      {cw.color_hex && (
                        <View style={[styles.colorwaySwatch, { backgroundColor: cw.color_hex }]} />
                      )}
                      <Text style={[styles.colorwayChipText, isSelected && styles.colorwayChipTextSelected]}>
                        {cw.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

                      <Text style={styles.fieldLabel}>Category</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.colorwayList}
                      >
                        <TouchableOpacity
                          style={[styles.colorwayChip, !categoryOverride && styles.colorwayChipSelected]}
                          onPress={() => setCategoryOverride(null)}
                        >
                          <Text style={[styles.colorwayChipText, !categoryOverride && styles.colorwayChipTextSelected]}>
                            Default
                          </Text>
                        </TouchableOpacity>
                        {CATEGORIES.map(cat => {
                          const isSelected = categoryOverride === cat;
                          return (
                            <TouchableOpacity
                              key={cat}
                              style={[styles.colorwayChip, isSelected && styles.colorwayChipSelected]}
                              onPress={() => setCategoryOverride(cat)}
                            >
                              <Text style={[styles.colorwayChipText, isSelected && styles.colorwayChipTextSelected]}>
                                {cat.charAt(0).toUpperCase() + cat.slice(1)}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>

                      <View ref={serialNumberRef}>
                        <Text style={styles.fieldLabel}>Serial Number</Text>
                        <TextInput
                          style={styles.detailInput}
                          placeholder="e.g. 123456"
                          placeholderTextColor={colors.textMuted}
                          value={serialNumber}
                          onChangeText={setSerialNumber}
                          onFocus={() => scrollToField(serialNumberRef)}
                        />
                      </View>

                      <View ref={notesRef}>
                        <Text style={styles.fieldLabel}>Notes</Text>
                        <TextInput
                          style={[styles.detailInput, styles.detailInputMultiline]}
                          placeholder="Any notes..."
                          placeholderTextColor={colors.textMuted}
                          value={acquiredNotes}
                          onChangeText={setAcquiredNotes}
                          multiline
                          onFocus={() => scrollToField(notesRef)}
                        />
                      </View>

                      {detailPedal?.status === 'retired' && (
                <>
                  <Text style={styles.sectionLabel}>Retirement</Text>
                  <Text style={styles.fieldLabel}>Date sold or traded</Text>
                  <DateField value={retiredDate} onChange={setRetiredDate} />

                  <View style={styles.segmentedRow}>
                    <TouchableOpacity
                      style={[styles.segmentedButton, retiredMethod === 'sale' && styles.segmentedButtonActive]}
                      onPress={() => setRetiredMethod('sale')}
                    >
                      <Text style={[styles.segmentedText, retiredMethod === 'sale' && styles.segmentedTextActive]}>
                        Sold
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.segmentedButton, retiredMethod === 'trade' && styles.segmentedButtonActive]}
                      onPress={() => setRetiredMethod('trade')}
                    >
                      <Text style={[styles.segmentedText, retiredMethod === 'trade' && styles.segmentedTextActive]}>
                        Traded
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {retiredMethod === 'sale' ? (
                    <>
                      <Text style={styles.fieldLabel}>Sale price</Text>
                      <TextInput
                        style={styles.detailInput}
                        placeholder="0.00"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="decimal-pad"
                        value={retiredPrice}
                        onChangeText={setRetiredPrice}
                      />
                      <Text style={styles.fieldLabel}>Sold to</Text>
                      <TextInput
                        style={styles.detailInput}
                        placeholder="Buyer"
                        placeholderTextColor={colors.textMuted}
                        value={retiredTo}
                        onChangeText={setRetiredTo}
                      />
                    </>
                  ) : (
                    <>
                      <Text style={styles.fieldLabel}>Traded for</Text>
                      <TextInput
                        style={styles.detailInput}
                        placeholder="What you got"
                        placeholderTextColor={colors.textMuted}
                        value={retiredTradeFor}
                        onChangeText={setRetiredTradeFor}
                      />
                      <Text style={styles.fieldLabel}>Traded with</Text>
                      <TextInput
                        style={styles.detailInput}
                        placeholder="Who you traded with"
                        placeholderTextColor={colors.textMuted}
                        value={retiredTo}
                        onChangeText={setRetiredTo}
                      />
                    </>
                  )}

                  <View ref={retiredNotesRef}>
                    <Text style={styles.fieldLabel}>Notes</Text>
                    <TextInput
                      style={[styles.detailInput, styles.detailInputMultiline]}
                      placeholder="Retirement notes..."
                      placeholderTextColor={colors.textMuted}
                      value={retiredNotes}
                      onChangeText={setRetiredNotes}
                      multiline
                      onFocus={() => scrollToField(retiredNotesRef)}
                    />
                  </View>
                </>
              )}

                      {/* ── Pedal History / Trace ── */}
                      {detailPedal && (
                        <View style={styles.traceSection}>
                          <Text style={styles.sectionLabel}>Pedal History</Text>
                          {chainLoading ? (
                            <ActivityIndicator color={colors.teal} style={{ marginTop: spacing.sm }} />
                          ) : pedalChain.length >= 2 ? (
                            <>
                              {pedalChain.map((node, idx) => {
                                const isCurrent = node.id === detailPedal?.id;
                                const isFirst = idx === 0;
                                const date = node.acquired_date ? toDisplayDate(node.acquired_date) : null;
                                const name = node.pedal ? `${node.pedal.brand} ${node.pedal.model}` : 'Unknown pedal';
                                return (
                                  <View key={node.id} style={styles.traceRow}>
                                    {!isFirst && (
                                      <View style={styles.traceConnector}>
                                        <Ionicons name="arrow-down" size={14} color={colors.teal} />
                                        <Text style={styles.traceConnectorText}>
                                          {node.trade_cash_paid && node.trade_cash_paid > 0
                                            ? `Traded + $${node.trade_cash_paid}`
                                            : node.trade_cash_paid && node.trade_cash_paid < 0
                                            ? `Traded − $${Math.abs(node.trade_cash_paid)}`
                                            : 'Traded'}
                                        </Text>
                                      </View>
                                    )}
                                    <View style={[styles.traceCard, isCurrent && styles.traceCardCurrent]}>
                                      <View style={styles.traceCardHeader}>
                                        <Text style={[styles.traceCardName, isCurrent && styles.traceCardNameCurrent]}>
                                          {name}
                                        </Text>
                                        {isCurrent && (
                                          <View style={styles.traceCurrentBadge}>
                                            <Text style={styles.traceCurrentBadgeText}>Current</Text>
                                          </View>
                                        )}
                                      </View>
                                      {isFirst && node.acquired_method === 'purchase' && (
                                        <Text style={styles.traceCardMeta}>
                                          💰 Paid {node.purchase_price != null ? fmt(node.purchase_price) : '—'}
                                          {node.acquired_from ? ` · ${node.acquired_from}` : ''}
                                        </Text>
                                      )}
                                      {date ? <Text style={styles.traceCardDate}>{date}</Text> : null}
                                      {node.acquired_trade_with ? (
                                        <Text style={styles.traceCardMeta}>with {node.acquired_trade_with}</Text>
                                      ) : null}
                                    </View>
                                  </View>
                                );
                              })}
                              {/* Total cost */}
                              {(() => {
                                const total = pedalChain.reduce((sum, n) => {
                                  if (n.acquired_method === 'purchase' && n.purchase_price) sum += n.purchase_price;
                                  if (n.trade_cash_paid) sum += n.trade_cash_paid;
                                  return sum;
                                }, 0);
                                return total > 0 ? (
                                  <View style={styles.traceTotalRow}>
                                    <Text style={styles.traceTotalLabel}>Total cash invested</Text>
                                    <Text style={styles.traceTotalValue}>{fmt(total)}</Text>
                                  </View>
                                ) : null;
                              })()}
                            </>
                          ) : pedalChain.length === 1 && pedalChain[0].acquired_method === 'purchase' ? (
                            <View style={styles.traceCard}>
                              <Text style={styles.traceCardMeta}>
                                💰 Purchased for {pedalChain[0].purchase_price != null ? fmt(pedalChain[0].purchase_price) : '—'}
                                {pedalChain[0].acquired_from ? ` · ${pedalChain[0].acquired_from}` : ''}
                              </Text>
                              {pedalChain[0].acquired_date ? (
                                <Text style={styles.traceCardDate}>{toDisplayDate(pedalChain[0].acquired_date)}</Text>
                              ) : null}
                            </View>
                          ) : (
                            <Text style={styles.traceEmpty}>
                              Use the trade flow when adding pedals to build history here.
                            </Text>
                          )}
                        </View>
                      )}

                      {/* Reassign pedal — always accessible at the bottom */}
                      {detailPedal && !showRetireSection && (
                        <TouchableOpacity
                          style={styles.reassignBtn}
                          onPress={openReassign}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="swap-horizontal-outline" size={16} color={colors.textMuted} />
                          <Text style={styles.reassignBtnText}>Reassign pedal</Text>
                        </TouchableOpacity>
                      )}

                      {/* "Got it back" — shown for retired pedals regardless of showRetireSection */}
                      {detailPedal?.status === 'retired' && (
                <View style={styles.detailDangerRow}>
                  <TouchableOpacity
                    style={styles.unretireBtn}
                    onPress={() => {
                      Alert.alert(
                        'Got it back?',
                        'This will move the pedal back to your Owned list and clear the retirement details.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Yes, move to Owned',
                            onPress: () => handleUnretirePedal(detailPedal),
                          },
                        ]
                      );
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="arrow-undo-outline" size={16} color={colors.teal} />
                    <Text style={styles.unretireBtnText}>Got it back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={handleRemovePedal}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.rose} />
                    <Text style={styles.removeBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              )}

                      {detailPedal && !showRetireSection && (
                <View style={styles.detailDangerRow}>
                  {detailPedal.status !== 'retired' && (
                    <TouchableOpacity
                      style={styles.retireBtn}
                      onPress={() => setShowRetireSection(true)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="archive-outline" size={16} color={colors.rose} />
                      <Text style={styles.retireBtnText}>Retire this pedal</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={handleRemovePedal}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.rose} />
                    <Text style={styles.removeBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              )}

                      {showRetireSection && detailPedal?.status !== 'retired' && (
                <>
                  <Text style={styles.sectionLabel}>Retirement</Text>

                  <Text style={styles.fieldLabel}>Why did you move on? <Text style={styles.fieldLabelOptional}>(optional)</Text></Text>
                  <View style={styles.retireReasonRow}>
                    {(['Didn\'t fit my sound', 'Too complex', 'Too simple', 'Needed the money', 'Upgraded', 'Other'] as const).map((reason) => (
                      <TouchableOpacity
                        key={reason}
                        style={[
                          styles.retireReasonChip,
                          retiredReason === reason && styles.retireReasonChipActive,
                        ]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setRetiredReason(retiredReason === reason ? null : reason);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[
                          styles.retireReasonChipText,
                          retiredReason === reason && styles.retireReasonChipTextActive,
                        ]}>
                          {reason}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>Date sold or traded</Text>
                  <DateField value={retiredDate} onChange={setRetiredDate} />

                  <View style={styles.segmentedRow}>
                    <TouchableOpacity
                      style={[styles.segmentedButton, retiredMethod === 'sale' && styles.segmentedButtonActive]}
                      onPress={() => setRetiredMethod('sale')}
                    >
                      <Text style={[styles.segmentedText, retiredMethod === 'sale' && styles.segmentedTextActive]}>
                        Sold
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.segmentedButton, retiredMethod === 'trade' && styles.segmentedButtonActive]}
                      onPress={() => setRetiredMethod('trade')}
                    >
                      <Text style={[styles.segmentedText, retiredMethod === 'trade' && styles.segmentedTextActive]}>
                        Traded
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {retiredMethod === 'sale' ? (
                    <>
                      <Text style={styles.fieldLabel}>Sale price</Text>
                      <TextInput
                        style={styles.detailInput}
                        placeholder="0.00"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="decimal-pad"
                        value={retiredPrice}
                        onChangeText={setRetiredPrice}
                      />
                      <Text style={styles.fieldLabel}>Sold to</Text>
                      <TextInput
                        style={styles.detailInput}
                        placeholder="Buyer"
                        placeholderTextColor={colors.textMuted}
                        value={retiredTo}
                        onChangeText={setRetiredTo}
                      />
                    </>
                  ) : (
                    <>
                      {/* ── Searchable new pedal picker ── */}
                      <Text style={styles.fieldLabel}>What did you get?</Text>
                      {retireNewPedal ? (
                        <View style={styles.retireSelectedPedal}>
                          <View style={styles.retireSelectedPedalInfo}>
                            <Text style={styles.retireSelectedPedalBrand}>{retireNewPedal.brand}</Text>
                            <Text style={styles.retireSelectedPedalModel}>{retireNewPedal.model}</Text>
                          </View>
                          <TouchableOpacity onPress={() => { setRetireNewPedal(null); setRetireNewColorways([]); setRetireNewColorwayId(null); }} activeOpacity={0.7}>
                            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <>
                          <View style={styles.retireSearchRow}>
                            <Ionicons name="search" size={16} color={colors.textMuted} />
                            <TextInput
                              style={styles.retireSearchInput}
                              value={retireTradeSearch}
                              onChangeText={handleRetireTradeSearch}
                              placeholder="Search by brand or model..."
                              placeholderTextColor={colors.textMuted}
                            />
                            {(retireTradeSearching || retireTradeUpserting) && (
                              <ActivityIndicator size="small" color={colors.teal} />
                            )}
                          </View>
                          {(retireTradeResults.length > 0 || retireTradeReverbResults.length > 0) && (
                            <View style={styles.retireSearchResults}>
                              {/* Catalog results */}
                              {retireTradeResults.slice(0, 6).map(p => (
                                <TouchableOpacity
                                  key={p.id}
                                  style={styles.resultRow}
                                  onPress={() => handleSelectRetireNewPedal(p)}
                                  activeOpacity={0.7}
                                >
                                  <View style={styles.resultRowContent}>
                                    <View style={styles.resultRowText}>
                                      <Text style={styles.resultBrand}>{p.brand}</Text>
                                      <Text style={styles.resultModel}>{p.model}</Text>
                                    </View>
                                    <View style={styles.resultRowRight}>
                                      <CategoryBadge category={p.category} small />
                                      {p.avg_price != null && (
                                        <Text style={styles.resultPrice}>${p.avg_price}</Text>
                                      )}
                                    </View>
                                  </View>
                                </TouchableOpacity>
                              ))}
                              {/* Reverb results not yet in catalog */}
                              {retireTradeReverbResults.length > 0 && (
                                <>
                                  {retireTradeResults.length > 0 && (
                                    <View style={styles.reverbDivider}>
                                      <Text style={styles.reverbDividerText}>Also found on Reverb</Text>
                                    </View>
                                  )}
                                  {retireTradeReverbResults.slice(0, 5).map((r, i) => (
                                    <TouchableOpacity
                                      key={`reverb-${i}`}
                                      style={styles.resultRow}
                                      onPress={() => handleSelectRetireTradeReverbResult(r)}
                                      activeOpacity={0.7}
                                    >
                                      <View style={styles.resultRowContent}>
                                        <View style={styles.resultRowText}>
                                          <Text style={styles.resultBrand}>{r.brand}</Text>
                                          <Text style={styles.resultModel}>{r.model}</Text>
                                        </View>
                                        <View style={styles.resultRowRight}>
                                          <CategoryBadge category={r.category} small />
                                          <View style={styles.reverbBadge}>
                                            <Text style={styles.reverbBadgeText}>NEW</Text>
                                          </View>
                                          {r.avg_price != null && (
                                            <Text style={styles.resultPrice}>${r.avg_price}</Text>
                                          )}
                                        </View>
                                      </View>
                                    </TouchableOpacity>
                                  ))}
                                </>
                              )}
                            </View>
                          )}
                        </>
                      )}

                      {/* Colorway for new pedal */}
                      {retireNewPedal && retireNewColorways.length > 0 && (
                        <>
                          <Text style={styles.fieldLabel}>Colorway</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorwayList}>
                            {retireNewColorways.map(cw => (
                              <TouchableOpacity
                                key={cw.id}
                                style={[styles.colorwayChip, retireNewColorwayId === cw.id && styles.colorwayChipSelected]}
                                onPress={() => setRetireNewColorwayId(cw.id)}
                              >
                                {cw.color_hex && <View style={[styles.colorwaySwatch, { backgroundColor: cw.color_hex }]} />}
                                <Text style={[styles.colorwayChipText, retireNewColorwayId === cw.id && styles.colorwayChipTextSelected]}>{cw.name}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </>
                      )}

                      <Text style={styles.fieldLabel}>Traded with</Text>
                      <TextInput
                        style={styles.detailInput}
                        placeholder="Person or shop"
                        placeholderTextColor={colors.textMuted}
                        value={retiredTo}
                        onChangeText={setRetiredTo}
                      />
                      <Text style={styles.fieldLabel}>Cash paid / received <Text style={styles.fieldLabelOptional}>(optional)</Text></Text>
                      <TextInput
                        style={styles.detailInput}
                        placeholder="e.g. 50 (paid) or -25 (received)"
                        placeholderTextColor={colors.textMuted}
                        value={retireCashPaid}
                        onChangeText={v => setRetireCashPaid(v.replace(/[^0-9.-]/g, ''))}
                        keyboardType="numbers-and-punctuation"
                      />
                    </>
                  )}

                  <Text style={styles.fieldLabel}>Notes</Text>
                  <TextInput
                    style={[styles.detailInput, styles.detailInputMultiline]}
                    placeholder="Retirement notes..."
                    placeholderTextColor={colors.textMuted}
                    value={retiredNotes}
                    onChangeText={setRetiredNotes}
                    multiline
                  />
                </>
              )}
                    </>
                  )}
              </>
            </KeyboardAwareScrollView>

            <View style={styles.detailActions}>
              <TouchableOpacity style={styles.detailCancel} onPress={closeDetail} activeOpacity={0.8}>
                <Text style={styles.detailCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.detailSave}
                onPress={saveDetail}
                activeOpacity={0.85}
                disabled={savingDetails}
              >
                {savingDetails ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.detailSaveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
            {/* ── Reassign overlay — lives inside the sheet to avoid nested-modal iOS issue ── */}
            {showReassignModal && (
              <View style={styles.reassignOverlay}>
                <TouchableOpacity onPress={closeReassign} activeOpacity={0.7} style={styles.modalCloseBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <Ionicons name="close" size={24} color={colors.textMuted} />
                </TouchableOpacity>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Reassign Pedal</Text>
                </View>
                {detailPedal?.pedal && (
                  <View style={styles.reassignCurrentRow}>
                    <Text style={styles.reassignCurrentLabel}>Currently:</Text>
                    <Text style={styles.reassignCurrentPedal} numberOfLines={1}>
                      {detailPedal.pedal.brand} {detailPedal.pedal.model}
                    </Text>
                  </View>
                )}
                <View style={styles.modalSearchRow}>
                  <Ionicons name="search-outline" size={18} color={colors.textMuted} />
                  <TextInput
                    style={styles.modalSearchInput}
                    placeholder="Search catalog…"
                    placeholderTextColor={colors.textMuted}
                    value={reassignQuery}
                    onChangeText={handleReassignSearch}
                    autoFocus
                    returnKeyType="search"
                    autoCorrect={false}
                  />
                  {reassignSearching
                    ? <ActivityIndicator size="small" color={colors.teal} />
                    : reassignQuery.length > 0
                      ? <TouchableOpacity onPress={() => handleReassignSearch('')}>
                          <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                      : null
                  }
                </View>
                <FlatList
                  data={reassignResults}
                  keyExtractor={item => item.id}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => {
                    const isCurrent = detailPedal?.pedal_id === item.id;
                    return (
                      <TouchableOpacity
                        style={[styles.resultRow, isCurrent && { opacity: 0.5 }]}
                        onPress={() => !isCurrent && handleReassignPedal(item)}
                        disabled={reassignSaving || isCurrent}
                        activeOpacity={0.75}
                      >
                        <View style={styles.resultRowContent}>
                          {item.image_url
                            ? <Image source={{ uri: item.image_url }} style={styles.resultThumb} />
                            : <View style={[styles.resultThumbPlaceholder, { backgroundColor: colors.background }]}>
                                <Ionicons name="hardware-chip-outline" size={18} color={colors.textMuted} />
                              </View>
                          }
                          <View style={styles.resultRowText}>
                            <Text style={styles.resultBrand}>{item.brand}</Text>
                            <Text style={styles.resultModel}>{item.model}</Text>
                          </View>
                          <View style={styles.resultRowRight}>
                            <CategoryBadge category={item.category} small />
                            {isCurrent
                              ? <Text style={{ fontSize: typography.sizes.xs, fontFamily: typography.body, color: colors.textMuted, fontStyle: 'italic' }}>current</Text>
                              : item.avg_price != null
                                ? <Text style={styles.resultPrice}>{fmt(item.avg_price)}</Text>
                                : null
                            }
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                  ListFooterComponent={
                    <>
                      {reassignReverbResults.length > 0 && (
                        <>
                          <View style={styles.reverbDivider}>
                            <Text style={styles.reverbDividerText}>Also found on Reverb</Text>
                          </View>
                          {reassignReverbResults.map((r, i) => (
                            <TouchableOpacity
                              key={`reverb-${i}`}
                              style={styles.resultRow}
                              onPress={() => handleReassignSelectReverb(r)}
                              disabled={reassignSaving}
                              activeOpacity={0.7}
                            >
                              <View style={styles.resultRowContent}>
                                {r.photo_url
                                  ? <Image source={{ uri: r.photo_url }} style={styles.resultThumb} />
                                  : <View style={[styles.resultThumbPlaceholder, { backgroundColor: colors.background }]}>
                                      <Ionicons name="hardware-chip-outline" size={18} color={colors.textMuted} />
                                    </View>
                                }
                                <View style={styles.resultRowText}>
                                  <Text style={styles.resultBrand}>{r.brand}</Text>
                                  <Text style={styles.resultModel}>{r.model}</Text>
                                </View>
                                <View style={styles.resultRowRight}>
                                  <CategoryBadge category={r.category} small />
                                  {r.avg_price != null && (
                                    <Text style={styles.resultPrice}>{fmt(r.avg_price)}</Text>
                                  )}
                                </View>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </>
                      )}
                      {reassignQuery.length > 0 && !reassignSearching && reassignResults.length === 0 && reassignReverbResults.length === 0 && (
                        <Text style={styles.noResults}>No results found</Text>
                      )}
                    </>
                  }
                />
                {reassignSaving && (
                  <View style={StyleSheet.absoluteFillObject}>
                    <ActivityIndicator color={colors.teal} style={{ flex: 1 }} />
                  </View>
                )}
              </View>
            )}
          </SwipeDismissSheet>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Share nudge banner ── */}
      {shareNudge && (
        <Animated.View
          style={[styles.shareNudgeBanner, { opacity: nudgeOpacity, transform: [{ translateY: nudgeOpacity.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}
          pointerEvents="box-none"
        >
          <Text style={styles.shareNudgeText}>{shareNudge.brand} {shareNudge.model} added</Text>
          <TouchableOpacity
            onPress={() => shareNewPedal(shareNudge.brand, shareNudge.model)}
            style={styles.shareNudgeBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="share-outline" size={14} color={colors.teal} />
            <Text style={styles.shareNudgeBtnText}>Share the drop</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (nudgeDismissRef.current) clearTimeout(nudgeDismissRef.current);
              Animated.timing(nudgeOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setShareNudge(null));
            }}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* ── FS/FT share card (off-screen, captured by react-native-view-shot) ── */}
      <View style={{ position: 'absolute', left: -9999, top: -9999 }} pointerEvents="none">
        <FsftShareCard
          ref={fsftCardRef}
          pedals={listedPedals
            .filter(p => p.pedal?.brand && p.pedal?.model && p.listing_status)
            .map(p => ({
              brand: p.pedal!.brand,
              model: p.pedal!.model,
              listing_status: p.listing_status!,
              asking_price: p.asking_price ?? null,
            }))}
          username={profile?.display_name ?? undefined}
        />
      </View>

      {/* ── Share config sheet ── */}
      <Modal
        visible={shareConfigOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setShareConfigOpen(false)}
      >
        <View style={styles.collectionModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setShareConfigOpen(false)}
          />
          <SwipeDismissSheet style={styles.collectionModalSheet} onDismiss={() => setShareConfigOpen(false)}>
            <TouchableOpacity onPress={() => setShareConfigOpen(false)} activeOpacity={0.7} style={styles.modalCloseBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </TouchableOpacity>
            {/* Header */}
            <View style={styles.collectionModalHeader}>
              <Text style={styles.collectionModalTitle}>{shareSource === 'gas' ? 'Share My GAS List' : 'Share My Collection'}</Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>

              {/* ── Category filter ── */}
              <Text style={styles.shareConfigLabel}>SHOW BY CATEGORY</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.shareConfigPillRow} contentContainerStyle={{ gap: spacing.xs }}>
                {/* "All" pill */}
                <TouchableOpacity
                  style={[styles.shareConfigPill, shareSelCategories.length === 0 && styles.shareConfigPillActive]}
                  onPress={() => { Haptics.selectionAsync(); setShareSelCategories([]); }}
                >
                  <Text style={[styles.shareConfigPillText, shareSelCategories.length === 0 && styles.shareConfigPillTextActive]}>All</Text>
                </TouchableOpacity>
                {availableShareCategories.map(cat => {
                  const active = shareSelCategories.includes(cat);
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.shareConfigPill, active && styles.shareConfigPillActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setShareSelCategories(prev =>
                          prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
                        );
                      }}
                    >
                      <Text style={[styles.shareConfigPillText, active && styles.shareConfigPillTextActive]}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* ── Pricing ── */}
              <Text style={styles.shareConfigLabel}>PRICING</Text>
              <View style={styles.shareConfigPillRow2}>
                {([
                  { key: 'none',   label: 'None'       },
                  { key: 'asking', label: 'Asking $'   },
                  { key: 'market', label: 'Market'     },
                  { key: 'paid',   label: 'Paid $'     },
                ] as { key: PriceMode; label: string }[]).map(opt => {
                  const active = sharePriceMode === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.shareConfigPill, active && styles.shareConfigPillActive]}
                      onPress={() => { Haptics.selectionAsync(); setSharePriceMode(opt.key); }}
                    >
                      <Text style={[styles.shareConfigPillText, active && styles.shareConfigPillTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ── Sort ── */}
              <Text style={styles.shareConfigLabel}>SORT BY</Text>
              <View style={styles.shareConfigPillRow2}>
                {([
                  { key: 'newest', label: 'Newest'  },
                  { key: 'oldest', label: 'Oldest'  },
                  { key: 'value',  label: 'Value ↓' },
                  { key: 'az',     label: 'A–Z'     },
                ] as { key: 'newest' | 'oldest' | 'az' | 'value'; label: string }[]).map(opt => {
                  const active = shareSort === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.shareConfigPill, active && styles.shareConfigPillActive]}
                      onPress={() => { Haptics.selectionAsync(); setShareSort(opt.key); }}
                    >
                      <Text style={[styles.shareConfigPillText, active && styles.shareConfigPillTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ── FS/FT only toggle (hidden for GAS list) ── */}
              {shareSource !== 'gas' && listedPedals.length > 0 && (
                <TouchableOpacity
                  style={styles.shareConfigToggleRow}
                  activeOpacity={0.7}
                  onPress={() => { Haptics.selectionAsync(); setShareFsftOnly(v => !v); }}
                >
                  <View>
                    <Text style={styles.shareConfigToggleLabel}>FS/FT only</Text>
                    <Text style={styles.shareConfigToggleSub}>Show only pedals listed for sale or trade</Text>
                  </View>
                  <View style={[styles.shareConfigToggle, shareFsftOnly && styles.shareConfigToggleOn]}>
                    <View style={[styles.shareConfigToggleThumb, shareFsftOnly && styles.shareConfigToggleThumbOn]} />
                  </View>
                </TouchableOpacity>
              )}

            </ScrollView>

            {/* ── Divider ── */}
            <View style={styles.shareConfigDivider} />

            {/* ── Pagination (if multiple pages) ── */}
            {totalCollectionPages > 1 && (
              <View style={styles.collectionPageNav}>
                <TouchableOpacity
                  style={[styles.collectionNavBtn, collectionPage === 0 && styles.collectionNavBtnDisabled]}
                  onPress={() => setCollectionPage(p => Math.max(0, p - 1))}
                  disabled={collectionPage === 0}
                >
                  <Ionicons name="chevron-back" size={22} color={collectionPage === 0 ? colors.textMuted : colors.textPrimary} />
                </TouchableOpacity>

                <View style={styles.collectionDots}>
                  {collectionPages.slice(0, 8).map((_, i) => (
                    <TouchableOpacity key={i} onPress={() => setCollectionPage(i)} hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}>
                      <View style={[styles.collectionDot, i === collectionPage && styles.collectionDotActive]} />
                    </TouchableOpacity>
                  ))}
                  {totalCollectionPages > 8 && <Text style={styles.shareConfigPillText}>…</Text>}
                </View>

                <TouchableOpacity
                  style={[styles.collectionNavBtn, collectionPage === totalCollectionPages - 1 && styles.collectionNavBtnDisabled]}
                  onPress={() => setCollectionPage(p => Math.min(totalCollectionPages - 1, p + 1))}
                  disabled={collectionPage === totalCollectionPages - 1}
                >
                  <Ionicons name="chevron-forward" size={22} color={collectionPage === totalCollectionPages - 1 ? colors.textMuted : colors.textPrimary} />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Share button ── */}
            {shareFilteredPedals.length > 0 ? (
              <TouchableOpacity
                style={styles.collectionSharePageBtn}
                activeOpacity={0.85}
                onPress={handleShareCurrentPage}
              >
                <LinearGradient colors={gradients.teal} style={styles.collectionSharePageBtnInner}>
                  <Ionicons name="share-outline" size={18} color="#fff" />
                  <Text style={styles.collectionSharePageBtnText}>
                    {totalCollectionPages > 1
                      ? `Share Page ${collectionPage + 1} of ${totalCollectionPages}`
                      : `Share ${shareFilteredPedals.length} pedal${shareFilteredPedals.length !== 1 ? 's' : ''}`}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <View style={styles.collectionSharePageBtn}>
                <View style={[styles.collectionSharePageBtnInner, { backgroundColor: colors.border }]}>
                  <Text style={[styles.collectionSharePageBtnText, { color: colors.textMuted }]}>No pedals match this filter</Text>
                </View>
              </View>
            )}

            {/* Save / Share all pages — only shown when multiple pages */}
            {totalCollectionPages > 1 && shareFilteredPedals.length > 0 && (
              <View style={{ gap: spacing.xs }}>
                <TouchableOpacity
                  style={styles.saveAllBtn}
                  activeOpacity={0.75}
                  onPress={handleShareAllPages}
                  disabled={savingAllPages}
                >
                  {savingAllPages ? (
                    <View style={styles.saveAllBtnInner}>
                      <ActivityIndicator size="small" color={colors.teal} />
                      <Text style={styles.saveAllBtnText}>Sharing…</Text>
                    </View>
                  ) : (
                    <View style={styles.saveAllBtnInner}>
                      <Ionicons name="share-outline" size={16} color={colors.teal} />
                      <Text style={styles.saveAllBtnText}>
                        Share All {totalCollectionPages} Pages
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveAllBtn}
                  activeOpacity={0.75}
                  onPress={handleSaveAllPages}
                  disabled={savingAllPages}
                >
                  {savingAllPages ? (
                    <View style={styles.saveAllBtnInner}>
                      <ActivityIndicator size="small" color={colors.teal} />
                      <Text style={styles.saveAllBtnText}>Saving…</Text>
                    </View>
                  ) : (
                    <View style={styles.saveAllBtnInner}>
                      <Ionicons name="download-outline" size={16} color={colors.teal} />
                      <Text style={styles.saveAllBtnText}>
                        Save All {totalCollectionPages} Pages to Photos
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </SwipeDismissSheet>
        </View>
      </Modal>

      {/* ── All collection page cards off-screen — all mounted so images pre-load in parallel ── */}
      {collectionPages.map((pagePedals, i) => (
        <View
          key={`csc-page-${i}`}
          style={{ position: 'absolute', left: -9999, top: 0 }}
          pointerEvents="none"
          collapsable={false}
          ref={el => { pageRefs.current[i] = el; }}
        >
          <CollectionShareCard
            pedals={pagePedals}
            username={profile?.display_name ?? undefined}
            priceMode={sharePriceMode}
            subtitle={shareCardSubtitle}
            title={shareSource === 'gas' ? 'MY GAS LIST' : undefined}
          />
        </View>
      ))}
    </View>
  );
}

// ─── AddPedalModal ────────────────────────────────────────────────────────────
type AddPedalModalProps = {
  visible: boolean;
  onClose: () => void;
  onAdded: (brand?: string, model?: string, isOwned?: boolean) => void;
  session: Session | null;
  defaultTab: 'owned' | 'wishlist' | 'listed';
  initialSearch?: string | null;
  openManual?: boolean;
};

type ReverbResult = {
  brand: string;
  model: string;
  category: string;
  avg_price: number | null;
  photo_url?: string | null;
  in_catalog: boolean;
  pedal_id: string | null;
};

function AddPedalModal({ visible, onClose, onAdded, session, defaultTab, initialSearch, openManual }: AddPedalModalProps) {
  const ownedPedals = useStore(s => s.ownedPedals);
  const profile = useStore(s => s.profile);
  const { fmt } = useFormatMoney();
  const detailScrollRef = useRef<ScrollView | null>(null);
  const tradeDetailsRef = useRef<View | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Pedal[]>([]);
  const [reverbResults, setReverbResults] = useState<ReverbResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [upsertingFromReverb, setUpsertingFromReverb] = useState(false);
  const searchIdRef = useRef(0);
  const [selectedPedal, setSelectedPedal] = useState<Pedal | null>(null);
  const [colorways, setColorways] = useState<PedalColorway[]>([]);
  const [selectedColorwayId, setSelectedColorwayId] = useState<string | null>(null);
  const [loadingColorways, setLoadingColorways] = useState(false);
  const [showAddColorway, setShowAddColorway] = useState(false);
  const [newColorwayName, setNewColorwayName] = useState('');
  const [newColorwayHex, setNewColorwayHex] = useState('');
  const [isSubmittingColorway, setIsSubmittingColorway] = useState(false);
  const [colorwaySubmitError, setColorwaySubmitError] = useState('');
  const [pricePaid, setPricePaid] = useState('');
  const [acquisitionType, setAcquisitionType] = useState<'bought' | 'traded' | 'wishlist' | null>(
    defaultTab === 'wishlist' ? 'wishlist' : 'bought'
  );
  const [acquiredDate, setAcquiredDate] = useState('');
  const [acquiredFrom, setAcquiredFrom] = useState('');
  const [acquiredNotes, setAcquiredNotes] = useState('');
  const [tradeWith, setTradeWith] = useState('');
  const [tradeCash, setTradeCash] = useState('');
  const [tradeQuery, setTradeQuery] = useState('');
  const [tradePedal, setTradePedal] = useState<UserPedal | null>(null);
  const [showTradeDetails, setShowTradeDetails] = useState(false);
  const [categoryOverride, setCategoryOverride] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualBrand, setManualBrand] = useState('');
  const [manualModel, setManualModel] = useState('');
  const [manualCategory, setManualCategory] = useState('drive');
  const [manualPhotoUri, setManualPhotoUri] = useState<string | null>(null);
  const [isUpsertingManual, setIsUpsertingManual] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the keyboard is currently visible so handleClose can decide
  // whether to wait for keyboardDidHide before unmounting the modal.
  const keyboardVisibleRef = useRef(false);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardWillShow', () => { keyboardVisibleRef.current = true; });
    const hideSub  = Keyboard.addListener('keyboardDidHide',  () => { keyboardVisibleRef.current = false; });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    if (visible) {
      setAcquisitionType(defaultTab === 'wishlist' ? 'wishlist' : 'bought');
      // If opened via scan, auto-run the search with the identified query
      if (initialSearch) {
        handleSearch(initialSearch);
      }
    }
  }, [defaultTab, visible]);

  // When opened after a failed scan, jump straight to the manual-add form
  useEffect(() => {
    if (visible && openManual) {
      setShowManualAdd(true);
    }
  }, [visible, openManual]);

  const tradeSuggestions = useMemo(() => {
    const q = tradeQuery.trim().toLowerCase();
    if (!q) return [];
    return ownedPedals
      .filter(p => p.pedal)
      .filter(p => {
        const label = `${p.pedal?.brand ?? ''} ${p.pedal?.model ?? ''}`.toLowerCase();
        return label.includes(q);
      })
      .slice(0, 6);
  }, [ownedPedals, tradeQuery]);

  const handleSearch = useCallback((query: string) => {
    setSearch(query);
    setSelectedPedal(null);
    setColorways([]);
    setSelectedColorwayId(null);
    setShowManualAdd(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setReverbResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      const safe = query.replace(/[^a-zA-Z0-9 \-_.]/g, '').trim().slice(0, 100);
      if (!safe) { setResults([]); setReverbResults([]); return; }

      const searchId = ++searchIdRef.current;
      setIsSearching(true);
      setResults([]);
      setReverbResults([]);

      // Fire Reverb search in background — doesn't block catalog results
      invokeEdgeFunction<SearchReverbResponse>('search-pedals', { query: safe }).then(({ data, error }) => {
        if (searchIdRef.current !== searchId) return; // stale, discard
        if (error) {
          // Extract HTTP status from FunctionsHttpError to pinpoint the failure
          const status = (error as { context?: { status?: number } })?.context?.status;
          if (__DEV__) {
            console.warn('[Reverb] invoke error — HTTP status:', status, '| message:', error.message);
            (error as { context?: Response })?.context?.text?.().then((body: string) =>
              console.warn('[Reverb] error body:', body)
            ).catch(() => {});
          }
          return;
        }
        if (__DEV__ && data?._debug) console.warn('[Reverb] debug:', JSON.stringify(data._debug));
        if (data?.results) {
          const all = data.results as ReverbResult[];
          if (__DEV__) console.log('[Reverb] total results:', all.length, '| not in catalog:', all.filter(r => !r.in_catalog).length);
          setReverbResults(all.filter((r: ReverbResult) => !r.in_catalog));
        }
      }).catch((e: unknown) => { if (__DEV__) console.warn('[Reverb] fetch error:', e); });

      // Catalog search via edge function (service-role — bypasses any RLS restrictions)
      try {
        const { data } = await invokeEdgeFunction<PedalSearchLocalResponse>('search-pedals', {
          query: safe,
          localOnly: true,
        });
        if (searchIdRef.current !== searchId) return; // stale
        setResults((data?.pedals as Pedal[]) ?? []);
      } catch {
        if (searchIdRef.current === searchId) setResults([]);
      }
      if (searchIdRef.current === searchId) setIsSearching(false);
    }, 400);
  }, []);

  const selectingPedalRef = useRef<string | null>(null);

  const handleSelectPedal = async (pedal: Pedal) => {
    Haptics.selectionAsync();
    selectingPedalRef.current = pedal.id;
    setSelectedPedal(pedal);
    setAddError('');
    setAcquisitionType(prev => prev ?? (defaultTab === 'wishlist' ? 'wishlist' : 'bought'));
    setAcquiredDate('');
    setAcquiredFrom('');
    setAcquiredNotes('');
    setTradeWith('');
    setTradeQuery('');
    setTradePedal(null);
    setShowTradeDetails(false);
    setCategoryOverride(null);
    setColorways([]);
    setSelectedColorwayId(null);
    setShowAddColorway(false);
    setNewColorwayName('');
    setNewColorwayHex('');
    setColorwaySubmitError('');
    setLoadingColorways(true);
    const { data } = await supabase
      .from('pedal_colorways')
      .select('*')
      .eq('pedal_id', pedal.id)
      .order('is_default', { ascending: false });
    // Bail out if the modal was closed or a different pedal was selected while we awaited
    if (selectingPedalRef.current !== pedal.id) return;
    selectingPedalRef.current = null;
    const list = (data as PedalColorway[]) ?? [];
    setColorways(list);
    const def = list.find(c => c.is_default);
    if (def) setSelectedColorwayId(def.id);
    setLoadingColorways(false);
  };

  const handleSelectReverbResult = async (result: ReverbResult) => {
    Haptics.selectionAsync();
    setUpsertingFromReverb(true);
    const { data, error } = await invokeEdgeFunction<SearchUpsertResponse>('search-pedals', {
      action: 'upsert',
      brand: result.brand,
      model: result.model,
      category: result.category,
      avg_price: result.avg_price,
      image_url: result.photo_url ?? null,
    });
    setUpsertingFromReverb(false);
    if (!error && data?.pedal) {
      handleSelectPedal(data.pedal as Pedal);
    }
  };

  const handleSubmitColorway = async () => {
    if (!selectedPedal || !session) return;
    const name = newColorwayName.trim();
    if (!name) { setColorwaySubmitError('Name is required.'); return; }

    const hex = newColorwayHex.trim();
    const hexValid = /^#[0-9A-Fa-f]{6}$/.test(hex);

    setColorwaySubmitError('');
    setIsSubmittingColorway(true);

    // 1. Exact match — silently reuse existing
    const exact = colorways.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (exact) {
      setSelectedColorwayId(exact.id);
      setShowAddColorway(false);
      setNewColorwayName('');
      setNewColorwayHex('');
      setIsSubmittingColorway(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }

    // 2. Fuzzy match — flag as possible duplicate
    const fuzzy = colorways.find(c =>
      c.name.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(c.name.toLowerCase())
    );

    const { data, error } = await supabase
      .from('pedal_colorways')
      .insert({
        pedal_id: selectedPedal.id,
        name,
        color_hex: hexValid ? hex : null,
        is_default: false,
        is_pending: true,
        duplicate_of: fuzzy ? fuzzy.id : null,
      })
      .select()
      .single();

    setIsSubmittingColorway(false);

    if (error) {
      setColorwaySubmitError(error.message);
      return;
    }

    const newCw = data as PedalColorway;
    setColorways(prev => [...prev, newCw]);
    setSelectedColorwayId(newCw.id);
    setShowAddColorway(false);
    setNewColorwayName('');
    setNewColorwayHex('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleAddFlow = async () => {
    if (!selectedPedal) {
      setAddError('Select a pedal to continue.');
      return;
    }
    // Validate live session — the store may hold a stale reference after token expiry
    const { data: { session: liveSession } } = await supabase.auth.getSession();
    if (!liveSession) {
      setAddError('Session expired. Please sign out and sign in again.');
      Alert.alert('Session expired', 'Please go to your Profile tab and sign out, then sign in again.');
      return;
    }
      if (!acquisitionType) {
        setAddError('Choose Bought, Traded, or Wishlist.');
        return;
      }
      if (acquisitionType === 'traded' && !showTradeDetails) {
        setShowTradeDetails(true);
        requestAnimationFrame(() => {
          tradeDetailsRef.current?.measureLayout(
            detailScrollRef.current as any,
            (_x, y) => detailScrollRef.current?.scrollTo({ y, animated: true }),
            () => {}
          );
        });
        return;
      }

    const status = acquisitionType === 'wishlist' ? 'wishlist' : 'owned';

    setIsAdding(true);
    setAddError('');

    try {
      // Multiples are allowed for all statuses — players have backup boards, multiple
      // colorways, and may wishlist the same pedal in different variants.

      const parsedPrice = pricePaid ? parseFloat(pricePaid) : null;
      if (acquisitionType === 'wishlist' && !parsedPrice) {
        setAddError('Please enter your desired price to add this to wishlist.');
        return;
      }
      if (acquisitionType === 'traded' && !tradePedal) {
        setAddError('Select the pedal you traded from your owned list.');
        return;
      }

      const today = new Date().toISOString().split('T')[0];
      const acquiredDateFinal = acquiredDate.trim() ? toDbDate(acquiredDate.trim()) : today;
      const tradeForLabel = tradePedal?.pedal
        ? `${tradePedal.pedal.brand} ${tradePedal.pedal.model}`
        : tradeQuery.trim() || null;
      const tradedNote = tradeForLabel ? `Traded for ${tradeForLabel} on ${acquiredDateFinal}.` : null;
      const acquiredNotesFinal =
        acquisitionType === 'traded'
          ? [acquiredNotes.trim(), tradedNote].filter(Boolean).join('\n') || null
          : acquiredNotes.trim() || null;

      let error: { message: string } | null = null;
      if (acquisitionType === 'traded' && tradePedal) {
        const tradedAwayNote = `Traded for ${selectedPedal.brand} ${selectedPedal.model} on ${acquiredDateFinal}.`;
        const existingRetiredNotes = tradePedal.retired_notes?.trim();
        const retiredNotesFinal = [existingRetiredNotes, tradedAwayNote].filter(Boolean).join('\n') || null;
        const { error: rpcError } = await supabase.rpc('trade_pedal', {
          p_new_pedal_id: selectedPedal.id,
          p_colorway_id: selectedColorwayId ?? null,
          p_acquired_date: acquiredDateFinal,
          p_acquired_trade_for: tradeForLabel,
          p_acquired_trade_with: tradeWith.trim() || null,
          p_traded_from_user_pedal_id: tradePedal.id,
          p_trade_cash_paid: tradeCash.trim() ? parseFloat(tradeCash.replace(/[^0-9.-]/g, '')) || null : null,
          p_notes: acquiredNotesFinal,
          p_category_override: categoryOverride ?? null,
          p_retired_note: retiredNotesFinal,
        });
        if (rpcError) error = rpcError;
      } else {
        const { data: inserted, error: insertError } = await supabase.from('user_pedals').insert({
          user_id: liveSession.user.id,
          pedal_id: selectedPedal.id,
          colorway_id: status === 'owned' ? (selectedColorwayId ?? null) : null,
          status,
          purchase_price: acquisitionType === 'bought' && parsedPrice ? parsedPrice : null,
          target_price: acquisitionType === 'wishlist' && parsedPrice ? parsedPrice : null,
          acquired_method: acquisitionType === 'bought' ? 'purchase' : null,
          acquired_date: status === 'owned' ? acquiredDateFinal : null,
          acquired_from: acquisitionType === 'bought' ? (acquiredFrom.trim() || null) : null,
          notes: status === 'owned' ? acquiredNotesFinal : null,
          category_override: status === 'owned' ? (categoryOverride ?? null) : null,
        }).select('id').single();
        if (insertError) error = insertError;

        // Upload photo captured during manual add (non-fatal if it fails)
        if (!insertError && inserted?.id && manualPhotoUri) {
          try {
            const userId = liveSession.user.id;
            const basePath = `${userId}/pedals/${inserted.id}/${Date.now()}`;
            const [fullAsset, thumbAsset] = await Promise.all([
              ImageManipulator.manipulateAsync(manualPhotoUri, [{ resize: { width: 1400 } }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }),
              ImageManipulator.manipulateAsync(manualPhotoUri, [{ resize: { width: 360 } }],  { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }),
            ]);
            const [fullBuf, thumbBuf] = await Promise.all([
              fetch(fullAsset.uri).then(r => r.arrayBuffer()),
              fetch(thumbAsset.uri).then(r => r.arrayBuffer()),
            ]);
            const path = `${basePath}.jpg`;
            const thumbPath = `${basePath}_sm.jpg`;
            await Promise.all([
              supabase.storage.from('user-pedal-photos').upload(path,      fullBuf,  { upsert: false, contentType: 'image/jpeg', cacheControl: '31536000' }),
              supabase.storage.from('user-pedal-photos').upload(thumbPath, thumbBuf, { upsert: false, contentType: 'image/jpeg', cacheControl: '31536000' }),
            ]);
            await supabase.from('user_pedals').update({ user_image_path: path }).eq('id', inserted.id);
          } catch {
            // Non-fatal — pedal was added, photo upload failed silently
          }
        }
      }

      if (error) {
        const classified = classifyError(error, { httpStatus: extractHttpStatus(error) });
        setAddError(classified.message);
        Alert.alert(classified.title, classified.message);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onAdded(selectedPedal?.brand, selectedPedal?.model, acquisitionType !== 'wishlist');
      handleClose();
    } catch {
      setAddError('Could not save this pedal. Please try again.');
      Alert.alert('Save failed', 'Could not save this pedal. Please try again.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddPrevious = async () => {
    if (!selectedPedal) return;
    const { data: { session: liveSession } } = await supabase.auth.getSession();
    if (!liveSession) {
      setAddError('Session expired. Please sign out and sign in again.');
      Alert.alert('Session expired', 'Please go to your Profile tab and sign out, then sign in again.');
      return;
    }
    setIsAdding(true);
    setAddError('');
    const today = new Date().toISOString().split('T')[0];
    const { error } = await supabase.from('user_pedals').insert({
      user_id: liveSession.user.id,
      pedal_id: selectedPedal.id,
      colorway_id: selectedColorwayId ?? null,
      status: 'retired',
      retired_date: today,
    });
    setIsAdding(false);
    if (error) {
      const classified = classifyError(error, { httpStatus: extractHttpStatus(error) });
      setAddError(classified.message);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onAdded(selectedPedal?.brand, selectedPedal?.model, false); // retired — no owned share nudge
      handleClose();
    }
  };

  const pickManualPhoto = async (source: 'camera' | 'library') => {
    if (source === 'camera') {
      const { granted } = await ImagePicker.requestCameraPermissionsAsync();
      if (!granted) return;
      const r = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85 });
      if (!r.canceled && r.assets?.[0]?.uri) setManualPhotoUri(r.assets[0].uri);
    } else {
      const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!granted) return;
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
      });
      if (!r.canceled && r.assets?.[0]?.uri) setManualPhotoUri(r.assets[0].uri);
    }
  };

  const promptManualPhoto = () => {
    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Take Photo', onPress: () => pickManualPhoto('camera') },
      { text: 'Photo Library', onPress: () => pickManualPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleManualUpsert = async () => {
    const brand = manualBrand.trim();
    const model = manualModel.trim();
    if (!brand || !model) return;
    setIsUpsertingManual(true);
    const { data, error } = await invokeEdgeFunction<SearchUpsertResponse>('search-pedals', {
      action: 'upsert',
      brand,
      model,
      category: manualCategory,
      avg_price: null,
    });
    setIsUpsertingManual(false);
    if (!error && data?.pedal) {
      setShowManualAdd(false);
      setManualBrand('');
      setManualModel('');
      setManualCategory('drive');
      handleSelectPedal(data.pedal as Pedal);
    }
  };

  const handleClose = () => {
    // Cancel any in-flight debounce search so it doesn't fire after close
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // Cancel any in-flight colorway fetch
    selectingPedalRef.current = null;

    const doClose = () => {
      setSearch('');
      setResults([]);
      setReverbResults([]);
      setIsSearching(false);
      setSelectedPedal(null);
      setColorways([]);
      setSelectedColorwayId(null);
      setLoadingColorways(false);
      setShowAddColorway(false);
      setNewColorwayName('');
      setNewColorwayHex('');
      setColorwaySubmitError('');
      setPricePaid('');
      setAcquisitionType(defaultTab === 'wishlist' ? 'wishlist' : 'bought');
      setAcquiredDate('');
      setAcquiredFrom('');
      setAcquiredNotes('');
      setTradeWith('');
      setTradeQuery('');
      setTradePedal(null);
      setCategoryOverride(null);
      setAddError('');
      setShowManualAdd(false);
      setManualBrand('');
      setManualModel('');
      setManualCategory('drive');
      setManualPhotoUri(null);
      onClose();
    };

    if (keyboardVisibleRef.current) {
      // Keyboard is up — dismiss it and wait for the native animation to fully
      // complete before touching any modal state or visibility. A fixed timeout
      // is unreliable; keyboardDidHide fires exactly when the animation ends.
      Keyboard.dismiss();
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        hideSub.remove();
        clearTimeout(fallback);
        doClose();
      };
      const hideSub = Keyboard.addListener('keyboardDidHide', settle);
      // Safety net: if keyboardDidHide somehow never fires, close after 500ms.
      const fallback = setTimeout(settle, 500);
    } else {
      // No keyboard — no animation to wait for, close immediately.
      doClose();
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={undefined}
      >
        <TouchableOpacity style={styles.modalBackdrop} onPress={handleClose} activeOpacity={1} />
        <SwipeDismissSheet style={styles.modalSheet} onDismiss={handleClose}>

          {/* Corner close button */}
          <TouchableOpacity onPress={handleClose} activeOpacity={0.7} style={styles.modalCloseBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Pedal</Text>
          </View>

          {/* Acquisition type (first step) */}
          <View style={styles.acqSection}>
            <Text style={styles.fieldLabel}>How did you get it?</Text>
            <View style={styles.acqRow}>
              {(['bought', 'traded', 'wishlist'] as const).map(type => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.acqChip, acquisitionType === type && styles.acqChipActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setAddError('');
                        setAcquisitionType(type);
                        if (type === 'traded') {
                          setShowTradeDetails(false);
                        }
                      }}
                      activeOpacity={0.8}
                    >
                  <Text style={[styles.acqChipText, acquisitionType === type && styles.acqChipTextActive]}>
                    {type === 'bought' ? 'Bought' : type === 'traded' ? 'Traded' : 'GAS List'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Search input */}
          <View style={styles.modalSearchRow}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.modalSearchInput}
              value={search}
              onChangeText={handleSearch}
              placeholder="Search by brand or model..."
              placeholderTextColor={colors.textMuted}
              autoFocus={!selectedPedal && !initialSearch}
            />
            {isSearching && <ActivityIndicator size="small" color={colors.teal} />}
          </View>

          {/* Results or selected pedal */}
          {selectedPedal ? (
            <KeyboardAwareScrollView
              style={styles.selectedPedalWrap}
              contentContainerStyle={styles.selectedPedalContent}
              innerRef={(ref) => { (detailScrollRef as any).current = ref; }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              enableOnAndroid
              extraScrollHeight={16}
            >
              <View style={styles.selectedPedal}>
                <View style={styles.selectedPedalInfo}>
                  <CategoryBadge category={selectedPedal.category} small />
                  <Text style={styles.selectedPedalBrand}>{selectedPedal.brand}</Text>
                  <Text style={styles.selectedPedalModel}>{selectedPedal.model}</Text>
                  {selectedPedal.avg_price && (
                    <Text style={styles.selectedPedalPrice}>${selectedPedal.avg_price}</Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => { setSelectedPedal(null); setColorways([]); setSelectedColorwayId(null); }}>
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {acquisitionType === 'bought' && (
                <View style={styles.addFieldGroup}>
                  <Text style={styles.fieldLabel}>Date acquired</Text>
                  <DateField value={acquiredDate} onChange={setAcquiredDate} />
                  <Text style={styles.fieldLabel}>Purchase price</Text>
                  <TextInput
                    style={styles.detailInput}
                    value={pricePaid}
                    onChangeText={v => setPricePaid(v.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                  <Text style={styles.fieldLabel}>Where purchased</Text>
                  <TextInput
                    style={styles.detailInput}
                    value={acquiredFrom}
                    onChangeText={setAcquiredFrom}
                    placeholder="Store or seller"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              )}

              {acquisitionType === 'traded' && showTradeDetails && (
                <View style={styles.addFieldGroup} ref={tradeDetailsRef}>
                  <Text style={styles.stepBadge}>Step 2 of 2</Text>
                  <Text style={styles.fieldLabel}>Date acquired</Text>
                  <DateField value={acquiredDate} onChange={setAcquiredDate} />
                  <Text style={styles.fieldLabel}>What you traded</Text>
                  <TextInput
                    style={styles.detailInput}
                    value={tradeQuery}
                    onChangeText={(v) => {
                      setTradeQuery(v);
                      setTradePedal(null);
                    }}
                    placeholder="Start typing a pedal you own"
                    placeholderTextColor={colors.textMuted}
                  />
                  {tradeSuggestions.length > 0 && (
                    <View style={styles.tradeSuggestList}>
                      {tradeSuggestions.map(p => (
                        <TouchableOpacity
                          key={p.id}
                          style={styles.tradeSuggestRow}
                          onPress={() => {
                            const label = `${p.pedal?.brand ?? ''} ${p.pedal?.model ?? ''}`.trim();
                            setTradePedal(p);
                            setTradeQuery(label);
                          }}
                        >
                          <Text style={styles.tradeSuggestText}>{p.pedal?.model}</Text>
                          <Text style={styles.tradeSuggestSub}>{p.pedal?.brand}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  <Text style={styles.fieldLabel}>Traded with</Text>
                  <TextInput
                    style={styles.detailInput}
                    value={tradeWith}
                    onChangeText={setTradeWith}
                    placeholder="Person or shop"
                    placeholderTextColor={colors.textMuted}
                  />
                  <Text style={styles.fieldLabel}>Cash paid / received <Text style={styles.fieldLabelOptional}>(optional)</Text></Text>
                  <TextInput
                    style={styles.detailInput}
                    value={tradeCash}
                    onChangeText={v => setTradeCash(v.replace(/[^0-9.-]/g, ''))}
                    placeholder="e.g. 50 (paid) or -25 (received)"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              )}

              {acquisitionType === 'wishlist' && (
                <View style={styles.addFieldGroup}>
                  <Text style={styles.fieldLabel}>Desired price</Text>
                  <TextInput
                    style={styles.detailInput}
                    value={pricePaid}
                    onChangeText={v => setPricePaid(v.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
              )}

              {/* ── Colorway picker ── */}
              {acquisitionType && acquisitionType !== 'wishlist' && (acquisitionType !== 'traded' || showTradeDetails) && (
                loadingColorways ? (
                  <ActivityIndicator size="small" color={colors.teal} style={{ alignSelf: 'flex-start' }} />
                ) : (
                  <View style={styles.colorwaySection}>
                    <Text style={styles.colorwayLabel}>Colorway</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.colorwayList}
                    >
                      {/* Standard = no colorway, use primary image */}
                      <TouchableOpacity
                        style={[styles.colorwayChip, selectedColorwayId === null && styles.colorwayChipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setSelectedColorwayId(null); }}
                        activeOpacity={0.7}
                      >
                        {selectedPedal?.image_url ? (
                          <Image source={{ uri: selectedPedal.image_url }} style={styles.colorwaySwatch} resizeMode="cover" />
                        ) : null}
                        <Text style={[styles.colorwayChipText, selectedColorwayId === null && styles.colorwayChipTextSelected]}>
                          Standard
                        </Text>
                      </TouchableOpacity>
                      {colorways.map(cw => {
                        const isSelected = selectedColorwayId === cw.id;
                        return (
                          <TouchableOpacity
                            key={cw.id}
                            style={[styles.colorwayChip, isSelected && styles.colorwayChipSelected]}
                            onPress={() => { Haptics.selectionAsync(); setSelectedColorwayId(cw.id); }}
                            activeOpacity={0.7}
                          >
                            {cw.color_hex ? (
                              <View style={[styles.colorwaySwatch, { backgroundColor: cw.color_hex }]} />
                            ) : null}
                            <Text style={[styles.colorwayChipText, isSelected && styles.colorwayChipTextSelected]}>
                              {cw.name}
                            </Text>
                            {cw.year_released ? (
                              <Text style={styles.colorwayYear}>{cw.year_released}</Text>
                            ) : null}
                            {cw.is_pending ? (
                              <View style={styles.pendingDot} />
                            ) : null}
                          </TouchableOpacity>
                        );
                      })}
                      {!showAddColorway && (
                        <TouchableOpacity
                          style={styles.colorwayAddChip}
                          onPress={() => { Haptics.selectionAsync(); setShowAddColorway(true); }}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="add" size={14} color={colors.teal} />
                          <Text style={styles.colorwayAddChipText}>Add</Text>
                        </TouchableOpacity>
                      )}
                    </ScrollView>

                    {showAddColorway && (
                      <View style={styles.colorwayForm}>
                        <TextInput
                          style={styles.colorwayNameInput}
                          value={newColorwayName}
                          onChangeText={v => { setNewColorwayName(v); setColorwaySubmitError(''); }}
                          placeholder="Name (e.g. Desert Tan)"
                          placeholderTextColor={colors.textMuted}
                          autoFocus
                        />
                        <View style={styles.colorwayHexRow}>
                          <View
                            style={[
                              styles.colorwayHexPreview,
                              { backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(newColorwayHex) ? newColorwayHex : colors.border },
                            ]}
                          />
                          <TextInput
                            style={styles.colorwayHexInput}
                            value={newColorwayHex}
                            onChangeText={text => {
                              const v = text.startsWith('#') ? text : '#' + text;
                              setNewColorwayHex(v.slice(0, 7));
                            }}
                            placeholder="#RRGGBB"
                            placeholderTextColor={colors.textMuted}
                            maxLength={7}
                            autoCapitalize="characters"
                          />
                        </View>
                        {colorwaySubmitError ? (
                          <Text style={styles.addError}>{colorwaySubmitError}</Text>
                        ) : null}
                        <View style={styles.colorwayFormActions}>
                          <TouchableOpacity
                            style={styles.colorwayFormCancel}
                            onPress={() => {
                              setShowAddColorway(false);
                              setNewColorwayName('');
                              setNewColorwayHex('');
                              setColorwaySubmitError('');
                            }}
                          >
                            <Text style={styles.colorwayFormCancelText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.colorwayFormSubmit}
                            onPress={handleSubmitColorway}
                            disabled={isSubmittingColorway}
                            activeOpacity={0.8}
                          >
                            {isSubmittingColorway ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Text style={styles.colorwayFormSubmitText}>Submit</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                )
              )}

              {acquisitionType && acquisitionType !== 'wishlist' && (acquisitionType !== 'traded' || showTradeDetails) && (
                <View style={styles.addFieldGroup}>
                  <Text style={styles.fieldLabel}>Category</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
                  >
                    <TouchableOpacity
                      style={[styles.chip, !categoryOverride && styles.chipActive]}
                      onPress={() => setCategoryOverride(null)}
                    >
                      <Text style={[styles.chipText, !categoryOverride && styles.chipTextActive]}>
                        Default
                      </Text>
                    </TouchableOpacity>
                    {CATEGORIES.map(cat => (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.chip, categoryOverride === cat && styles.chipActive]}
                        onPress={() => setCategoryOverride(cat)}
                      >
                        <Text style={[styles.chipText, categoryOverride === cat && styles.chipTextActive]}>
                          {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {acquisitionType && acquisitionType !== 'wishlist' && (acquisitionType !== 'traded' || showTradeDetails) && (
                <View style={styles.addFieldGroup}>
                  <Text style={styles.fieldLabel}>Notes</Text>
                  <TextInput
                    style={[styles.detailInput, styles.detailInputMultiline]}
                    value={acquiredNotes}
                    onChangeText={setAcquiredNotes}
                    placeholder="Any notes..."
                    placeholderTextColor={colors.textMuted}
                    multiline
                  />
                </View>
              )}

              {acquisitionType && acquisitionType !== 'wishlist' && (
                <View style={styles.addFieldGroup}>
                  <Text style={styles.fieldLabel}>Photo</Text>
                  <TouchableOpacity style={styles.manualPhotoBtn} onPress={promptManualPhoto} activeOpacity={0.7}>
                    {manualPhotoUri ? (
                      <Image source={{ uri: manualPhotoUri }} style={styles.manualPhotoThumb} />
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={18} color={colors.teal} />
                        <Text style={styles.manualPhotoBtnText}>Add Photo (optional)</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {addError ? (
                <Text style={styles.addError}>{addError}</Text>
              ) : null}

              <View style={styles.addButtons}>
                <TouchableOpacity
                  style={[styles.addBtn, styles.addBtnOwned]}
                  onPress={handleAddFlow}
                  disabled={isAdding || !acquisitionType}
                  activeOpacity={0.8}
                >
                  {isAdding ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.addBtnText}>
                      {acquisitionType === 'wishlist'
                        ? 'Add to GAS List'
                        : acquisitionType === 'traded' && !showTradeDetails
                        ? 'Continue Trade Details'
                        : 'Add to Vault'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.addBtnPrevious}
                onPress={handleAddPrevious}
                disabled={isAdding}
                activeOpacity={0.8}
              >
                <Text style={styles.addBtnPreviousText}>Add as Previous (used to own)</Text>
              </TouchableOpacity>
            </KeyboardAwareScrollView>
          ) : (
            <ScrollView
              style={styles.resultsList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {upsertingFromReverb && (
                <ActivityIndicator size="small" color={colors.teal} style={{ marginVertical: spacing.md }} />
              )}
              {/* Always show manual entry once the user has typed something */}
              {search.length > 0 && !isSearching && !showManualAdd && (
                <TouchableOpacity
                  style={styles.manualAddTrigger}
                  onPress={() => {
                    // Split "brand model" on first word so fields are pre-filled correctly.
                    // e.g. "hologram chroma console" → brand="Hologram", model="Chroma Console"
                    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
                    const parts = search.trim().split(/\s+/);
                    setManualBrand(parts[0] ? cap(parts[0]) : '');
                    setManualModel(parts.slice(1).map(cap).join(' '));
                    setShowManualAdd(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add-circle-outline" size={16} color={colors.teal} />
                  <Text style={styles.manualAddTriggerText}>
                    {results.length === 0 && reverbResults.length === 0
                      ? `No results — add "${search}" manually`
                      : "Can't find it? Add manually"}
                  </Text>
                </TouchableOpacity>
              )}

              {showManualAdd && (
                <View style={styles.manualAddForm}>
                  {openManual && (
                    <View style={styles.scanFailBanner}>
                      <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
                      <Text style={styles.scanFailBannerText}>Couldn't identify that pedal — enter it manually</Text>
                    </View>
                  )}
                  <Text style={styles.manualAddLabel}>Add to catalog</Text>
                  <TextInput
                    style={styles.manualInput}
                    value={manualBrand}
                    onChangeText={setManualBrand}
                    placeholder="Brand"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="words"
                  />
                  <TextInput
                    style={styles.manualInput}
                    value={manualModel}
                    onChangeText={setManualModel}
                    placeholder="Model"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="words"
                  />
                  <Text style={styles.manualCategoryLabel}>Category</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
                  >
                    {CATEGORIES.map(cat => (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.chip, manualCategory === cat && styles.chipActive]}
                        onPress={() => setManualCategory(cat)}
                      >
                        <Text style={[styles.chipText, manualCategory === cat && styles.chipTextActive]}>
                          {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <TouchableOpacity style={styles.manualPhotoBtn} onPress={promptManualPhoto} activeOpacity={0.7}>
                    {manualPhotoUri ? (
                      <Image source={{ uri: manualPhotoUri }} style={styles.manualPhotoThumb} />
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={18} color={colors.teal} />
                        <Text style={styles.manualPhotoBtnText}>Add Photo (optional)</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <View style={styles.addButtons}>
                    <TouchableOpacity
                      style={[styles.addBtn, { backgroundColor: colors.border }]}
                      onPress={() => setShowManualAdd(false)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.addBtnText, { color: colors.textMuted }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.addBtn, styles.addBtnOwned]}
                      onPress={handleManualUpsert}
                      disabled={isUpsertingManual || !manualBrand.trim() || !manualModel.trim()}
                      activeOpacity={0.8}
                    >
                      {isUpsertingManual ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.addBtnText}>Add to Catalog</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {search.length === 0 && (
                <Text style={styles.searchHint}>Start typing to search the catalog and Reverb...</Text>
              )}

              {/* Catalog results — verified first */}
              {[...results].sort((a, b) => (b.is_verified ? 1 : 0) - (a.is_verified ? 1 : 0)).map(pedal => (
                <TouchableOpacity
                  key={pedal.id}
                  style={styles.resultRow}
                  onPress={() => handleSelectPedal(pedal)}
                  activeOpacity={0.7}
                >
                  <View style={styles.resultRowContent}>
                    {pedal.image_url ? (
                      <Image source={{ uri: pedal.image_url }} style={styles.resultThumb} />
                    ) : (
                      <View style={[styles.resultThumbPlaceholder, { backgroundColor: colors.surface }]}>
                        <Ionicons name="hardware-chip-outline" size={18} color={colors.textMuted} />
                      </View>
                    )}
                    <View style={styles.resultRowText}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <Text style={styles.resultBrand}>{pedal.brand}</Text>
                        {pedal.is_verified && (
                          <Image source={require('../../assets/tpc-square.png')} style={{ width: 13, height: 13 }} resizeMode="contain" />
                        )}
                      </View>
                      <Text style={styles.resultModel}>{pedal.model}</Text>
                    </View>
                    <View style={styles.resultRowRight}>
                      <CategoryBadge category={pedal.category} small />
                      {pedal.avg_price != null && (
                        <Text style={styles.resultPrice}>{fmt(pedal.avg_price)}</Text>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              ))}

              {/* Reverb-sourced results — suppressed when a verified catalog match exists */}
              {reverbResults.length > 0 && !results.some(p => p.is_verified) && (
                <>
                  {results.length > 0 && (
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 6, marginHorizontal: 4 }} />
                  )}
                  {reverbResults.map((r, i) => (
                    <TouchableOpacity
                      key={`reverb-${i}`}
                      style={styles.resultRow}
                      onPress={() => handleSelectReverbResult(r)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.resultRowContent}>
                        {r.photo_url ? (
                          <Image source={{ uri: r.photo_url }} style={styles.resultThumb} />
                        ) : (
                          <View style={[styles.resultThumbPlaceholder, { backgroundColor: colors.surface }]}>
                            <Ionicons name="hardware-chip-outline" size={18} color={colors.textMuted} />
                          </View>
                        )}
                        <View style={styles.resultRowText}>
                          <Text style={styles.resultBrand}>{r.brand}</Text>
                          <Text style={styles.resultModel}>{r.model}</Text>
                        </View>
                        <View style={styles.resultRowRight}>
                          <CategoryBadge category={r.category} small />
                          <View style={styles.reverbBadge}>
                            <Text style={styles.reverbBadgeText}>REVERB</Text>
                          </View>
                          {r.avg_price != null && (
                            <Text style={styles.resultPrice}>{fmt(r.avg_price)}</Text>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </ScrollView>
          )}
        </SwipeDismissSheet>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.base,
  },
  headerTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  valuePair: {
    alignItems: 'flex-end',
  },
  valueLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: typography.bodyMedium,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  valueAmount: {
    fontSize: 13,
    color: colors.textPrimary,
    fontFamily: typography.bodySemiBold,
  },
  valueDot: {
    color: colors.border,
    fontSize: 12,
  },
  valueDeltaText: {
    fontSize: 12,
    fontFamily: typography.bodySemiBold,
  },
  valueDeltaPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  // Tabs
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    borderColor: colors.teal + '60',
  },
  tabGradientContent: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  tabText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  tabTextActive: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  tabBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: radius.full,
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignItems: 'center',
  },
  tabBadgeText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 42,
    gap: spacing.sm,
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  // Category chips
  chips: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipActive: {
    backgroundColor: colors.teal + '22',
    borderColor: colors.teal + '60',
  },
  chipText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  chipTextActive: {
    color: colors.teal,
  },
  // List
  listContent: {
    padding: spacing.base,
    paddingBottom: 80,
  },
  // Action bar
  actionBarWrap: {
    paddingHorizontal: spacing.base,
    marginTop: spacing.sm,
  },
  actionBarFade: {
    position: 'absolute',
    left: spacing.base,
    right: spacing.base,
    top: -18,
    height: 18,
  },
  actionBar: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionHalf: {
    flex: 1,
  },
  actionHalfCard: {
    borderRadius: radius.xl,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  actionHalfCardLight: {
    borderRadius: radius.xl,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.teal + '40',
  },
  scanActionBtn: {
    // square button, sits to the left of "Add a Pedal"
  },
  scanActionCard: {
    width: 48,
    height: 48,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: colors.teal + '50',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.teal + '10',
  },
  actionFull: {
    flex: 1,
  },
  actionFullCard: {
    borderRadius: radius.xl,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  actionHalfTitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  actionHalfTitleDark: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingBottom: 24,
    maxHeight: '92%',
    flex: 1,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 10,
    padding: spacing.xs,
  },
  modalHeader: {
    marginBottom: spacing.base,
    paddingRight: spacing.xl, // leave room for the absolute-positioned X
  },
  modalTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  modalSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 48,
    gap: spacing.sm,
    marginBottom: spacing.base,
    marginTop: spacing.sm,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  scanBtn: {
    padding: 2,
  },
  scanBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: spacing.xs,
  },
  scanChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.teal + '15',
    borderWidth: 1,
    borderColor: colors.teal + '40',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    marginBottom: spacing.sm,
    alignSelf: 'flex-start',
  },
  scanChipText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
    flex: 1,
  },
  detailContent: {
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  detailImageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  detailImage: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailImageFallback: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  detailImageFallbackText: {
    fontSize: 10,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  detailPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.teal + '80',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  detailPhotoBtnText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  boardStatusValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  boardStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  boardStatusText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  sectionLabel: {
    marginTop: spacing.sm,
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  fieldLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  fieldLabelOptional: {
    fontFamily: typography.body,
    color: colors.textMuted,
    opacity: 0.6,
  },
  // ── Trace styles ──
  traceSection: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  traceRow: {
    gap: 2,
  },
  traceConnector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: spacing.md,
    paddingVertical: 2,
  },
  traceConnectorText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.teal,
  },
  traceCard: {
    backgroundColor: colors.surfaceAlt ?? colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: 2,
  },
  traceCardCurrent: {
    borderColor: colors.teal,
    borderWidth: 1.5,
  },
  traceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  traceCardName: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.text,
    flex: 1,
  },
  traceCardNameCurrent: {
    color: colors.teal,
  },
  traceCurrentBadge: {
    backgroundColor: colors.teal + '20',
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  traceCurrentBadgeText: {
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  traceCardMeta: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textSecondary,
  },
  traceCardDate: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  traceTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  traceTotalLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textSecondary,
  },
  traceTotalValue: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  traceEmpty: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  // ── Retire trade search ──
  retireSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt ?? colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  retireSearchInput: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.text,
  },
  retireSearchResults: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginTop: 2,
  },
  retireSearchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  retireSearchResultBrand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    minWidth: 60,
  },
  retireSearchResultModel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.text,
    flex: 1,
  },
  retireReasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.md,
  },
  retireReasonChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  retireReasonChipActive: {
    borderColor: colors.teal,
    backgroundColor: colors.teal + '22',
  },
  retireReasonChipText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  retireReasonChipTextActive: {
    color: colors.teal,
    fontFamily: typography.bodySemiBold,
  },
  retireSelectedPedal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.teal + '15',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.teal,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retireSelectedPedalInfo: {
    flex: 1,
    gap: 1,
  },
  retireSelectedPedalBrand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  retireSelectedPedalModel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.text,
  },
  detailInput: {
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  detailInputMultiline: {
    height: 90,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  statusPillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  statusPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 38,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  statusPillActive: {
    backgroundColor: colors.teal + '1A',
    borderColor: colors.teal + '80',
  },
  statusPillReadOnly: {
    opacity: 0.85,
  },
  statusPillText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  statusPillTextActive: {
    color: colors.teal,
  },
  statusPillBoardDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusSubSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  segmentedButton: {
    flex: 1,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  segmentedButtonActive: {
    backgroundColor: colors.teal + '1A',
    borderColor: colors.teal + '80',
  },
  segmentedText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  segmentedTextActive: {
    color: colors.teal,
  },
  helperText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  wishlistHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sortRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sortChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sortChipActive: {
    borderColor: colors.teal + '80',
    backgroundColor: colors.teal + '1A',
  },
  sortChipText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  sortChipTextActive: {
    color: colors.teal,
  },
  wishlistLoading: {
    paddingVertical: spacing.base,
    alignItems: 'center',
    gap: spacing.sm,
  },
  reverbSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  reverbSummaryCount: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  reverbSummaryRange: {
    fontSize: typography.sizes.md,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  reverbSummaryCTA: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
  wishlistList: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  wishlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  wishlistTextBlock: {
    flex: 1,
    gap: 4,
  },
  wishlistTitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodyMedium,
    color: colors.textPrimary,
  },
  wishlistMeta: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  wishlistPrice: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  detailActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  detailCancel: {
    flex: 1,
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCancelText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  detailSave: {
    flex: 1,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailSaveText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  retireBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    borderWidth: 1,
    borderColor: colors.rose + '80',
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  retireBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.rose,
  },
  unretireBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    borderWidth: 1,
    borderColor: colors.teal + '80',
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  unretireBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
  reassignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  reassignBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  detailDangerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  removeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    backgroundColor: colors.rose,
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  removeBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: '#fff',
  },
  resultsList: {
    flex: 1,
  },
  resultRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
  },
  resultRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  resultThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  resultThumbPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  resultRowText: {
    flex: 1,
  },
  resultBrand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  resultModel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
    marginTop: 1,
  },
  resultRowRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  resultPrice: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
  noResults: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  noResultsWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.base,
  },
  manualAddTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.teal + '60',
    borderStyle: 'dashed',
    backgroundColor: colors.teal + '08',
  },
  manualAddTriggerText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  manualAddForm: {
    width: '100%',
    gap: spacing.sm,
  },
  manualAddLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  manualCategoryLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  manualInput: {
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  manualPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.teal + '60',
    borderStyle: 'dashed',
    backgroundColor: colors.teal + '08',
    overflow: 'hidden',
    minHeight: 44,
  },
  manualPhotoThumb: {
    width: '100%',
    height: 140,
    borderRadius: radius.lg,
    resizeMode: 'cover',
  },
  manualPhotoBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  scanFailBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.warning + '18',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  scanFailBannerText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.warning,
    flex: 1,
  },
  searchHint: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    lineHeight: 20,
  },
  // Selected pedal
  selectedPedalWrap: {
    flex: 1,
    gap: spacing.base,
  },
  selectedPedalContent: {
    gap: spacing.base,
    paddingBottom: spacing.lg,
  },
  selectedPedal: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.teal + '50',
    padding: spacing.md,
    gap: spacing.md,
  },
  selectedPedalInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  selectedPedalBrand: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.xs,
  },
  selectedPedalModel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  selectedPedalPrice: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.teal,
  },
  acqSection: {
    gap: spacing.sm,
  },
  acqRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  acqChip: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  acqChipActive: {
    borderColor: colors.teal,
    backgroundColor: colors.teal + '18',
  },
  acqChipText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  acqChipTextActive: {
    color: colors.teal,
    fontFamily: typography.bodySemiBold,
  },
  addFieldGroup: {
    gap: spacing.sm,
  },
  stepBadge: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
    backgroundColor: colors.teal + '18',
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tradeSuggestList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  tradeSuggestRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tradeSuggestText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  tradeSuggestSub: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  // Price paid input
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  priceInput: {
    flex: 1,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  priceCurrency: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  addError: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.error,
    textAlign: 'center',
  },
  addToLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  addButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  addBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnOwned: {
    backgroundColor: colors.teal,
  },
  addBtnWishlist: {
    backgroundColor: colors.rose,
  },
  addBtnText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },
  addBtnPrevious: {
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  addBtnPreviousText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  reverbDivider: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  reverbDividerText: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  reverbBadge: {
    backgroundColor: colors.teal + '22',
    borderWidth: 1,
    borderColor: colors.teal + '55',
    borderRadius: radius.full,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  reverbBadgeText: {
    fontSize: 8,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
    letterSpacing: 0.4,
  },
  // Colorway picker
  colorwaySection: {
    gap: spacing.sm,
  },
  colorwayLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  conditionRow: {
    gap: spacing.xs,
    paddingBottom: 2,
    paddingTop: 2,
  },
  conditionChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  conditionChipSelected: {
    borderColor: colors.teal,
    backgroundColor: colors.teal + '12',
  },
  conditionChipText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  conditionChipTextSelected: {
    color: colors.teal,
    fontFamily: typography.bodySemiBold,
  },
  colorwayList: {
    gap: spacing.sm,
    paddingBottom: 2,
  },
  colorwayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  colorwayChipSelected: {
    borderColor: colors.teal,
    backgroundColor: colors.teal + '12',
  },
  colorwaySwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  colorwayChipText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  colorwayChipTextSelected: {
    color: colors.teal,
    fontFamily: typography.bodySemiBold,
  },
  colorwayYear: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  // Pending dot on user-submitted colorway chips
  pendingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.teal,
    opacity: 0.7,
  },
  // "+ Add" chip in the colorway scroll list
  colorwayAddChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.teal + '60',
    borderStyle: 'dashed',
    backgroundColor: colors.teal + '08',
  },
  colorwayAddChipText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  // Inline add-colorway form
  colorwayForm: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  colorwayNameInput: {
    height: 42,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
  },
  colorwayHexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  colorwayHexPreview: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  colorwayHexInput: {
    flex: 1,
    height: 42,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    fontSize: typography.sizes.base,
    fontFamily: typography.body,
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  colorwayFormActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  colorwayFormCancel: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  colorwayFormCancelText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textMuted,
  },
  colorwayFormSubmit: {
    flex: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorwayFormSubmitText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },

  // Share nudge banner
  shareNudgeBanner: {
    position: 'absolute',
    bottom: 24,
    left: spacing.base,
    right: spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  shareNudgeText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textPrimary,
  },
  shareNudgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.teal + '60',
    backgroundColor: colors.teal + '12',
  },
  shareNudgeBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },

  // ── Target price / price alert ───────────────────────────────────────────
  targetPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  targetPriceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  targetPriceLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  targetPriceInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    minWidth: 80,
  },
  targetPriceCurrency: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginRight: 2,
  },
  targetPriceInput: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
    minWidth: 50,
    padding: 0,
  },
  keyboardAccessory: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'flex-end',
  },
  keyboardAccessoryButton: {
    backgroundColor: colors.teal + '18',
    borderWidth: 1,
    borderColor: colors.teal + '55',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  keyboardAccessoryButtonText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },

  // ── Share strips (collection / GAS / FS/FT) ──────────────────────────────
  shareCollectionRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingVertical: 11,
    backgroundColor: colors.teal + '0F',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.teal + '28',
  },
  shareCollectionText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },

  // ── Share GAS List strip ──────────────────────────────────────────────────
  shareGasListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  shareGasListText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },
  shareGasListCount: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },

  // ── Share config sheet ────────────────────────────────────────────────────
  shareConfigLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.bodySemiBold,
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  shareConfigPillRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  shareConfigPillRow2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  shareConfigPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  shareConfigPillActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  shareConfigPillText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodyMedium,
    color: colors.textSecondary,
  },
  shareConfigPillTextActive: {
    color: '#fff',
    fontFamily: typography.bodySemiBold,
  },
  shareConfigToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  shareConfigToggleLabel: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  shareConfigToggleSub: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginTop: 2,
  },
  shareConfigToggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  shareConfigToggleOn: {
    backgroundColor: colors.teal,
  },
  shareConfigToggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  shareConfigToggleThumbOn: {
    alignSelf: 'flex-end',
  },
  shareConfigDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  saveAllBtn: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.teal + '55',
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  saveAllBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  saveAllBtnText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.teal,
  },

  // ── Collection share pagination modal ─────────────────────────────────────
  collectionModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  collectionModalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  collectionModalHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  collectionModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  collectionModalTitle: {
    fontSize: typography.sizes.md,
    fontFamily: typography.display,
    color: colors.textPrimary,
  },
  collectionPageInfo: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  collectionPageNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.sm,
  },
  collectionNavBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectionNavBtnDisabled: {
    opacity: 0.3,
  },
  collectionDots: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  collectionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  collectionDotActive: {
    backgroundColor: colors.teal,
    width: 20,
    borderRadius: 4,
  },
  collectionSharePageBtn: {
    borderRadius: radius.full,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  collectionSharePageBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  collectionSharePageBtnText: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: '#fff',
  },

  // ── Gear Journey Card ─────────────────────────────────────────────────────
  gearJourneyCard: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  gearJourneyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  gearJourneyMeta: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
  },
  gearJourneyValue: {
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  gearJourneyPL: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  gearJourneyPLItem: {
    alignItems: 'flex-start',
    gap: 2,
  },
  gearJourneyPLLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  gearJourneyPLAmount: {
    fontSize: typography.sizes.base,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  gearJourneyNetBadge: {
    marginLeft: 'auto' as any,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  gearJourneyNetText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
  },
  reassignOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.base,
    paddingBottom: 24,
    zIndex: 10,
  },
  reassignCurrentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  reassignCurrentLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
  },
  reassignCurrentPedal: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
    flexShrink: 1,
  },
});
