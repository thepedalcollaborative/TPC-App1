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
import type { CollectionPedal, PriceMode } from '../components';
import { TabParamList } from '../types/navigation';
import { reverbAffiliateUrl } from '../lib/reverb';
import { shareGasList, shareNewPedal, shareFsftList, shareCollectionList, shareAsImage, type FsftPedal } from '../lib/share';
import { hasBetaFullAccess } from '../lib/subscription';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

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
  'drive',
  'boost',
  'compressor',
  'eq',
  'delay',
  'reverb',
  'modulation',
  'looper',
  'pitch',
  'utility',
  'ambient',
  'synth',
  'other',
  'multifx',
  'modeler',
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
  const { session, profile, ownedPedals, wishlistPedals, retiredPedals, listedPedals, totalInvested, totalMarketValue, marketValues, fetchPedals, userImageUrls, userImageThumbUrls, refreshUserImages, viewMode, boards, updateListingStatus } = useStore();

  const [activeTab, setActiveTab] = useState<'owned' | 'wishlist' | 'listed'>('owned');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

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
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailPedal, setDetailPedal] = useState<UserPedal | null>(null);
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
  const [serialNumber, setSerialNumber] = useState('');
  const [listingStatus, setListingStatus] = useState<'for_sale' | 'for_trade' | 'for_sale_or_trade' | null>(null);
  const [askingPrice, setAskingPrice] = useState('');
  const [tradeWants, setTradeWants] = useState('');
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
  const [wishlistListings, setWishlistListings] = useState<Array<{ title: string; price: number | null; currency: string | null; condition: string | null; date: string | null; url: string | null; photo_url?: string | null }>>([]);
  const [wishlistSort, setWishlistSort] = useState<'newest' | 'price'>('newest');
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [wishlistError, setWishlistError] = useState<string | null>(null);

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
    setSerialNumber(item.serial_number ?? '');
    setListingStatus(item.listing_status ?? null);
    setAskingPrice(item.asking_price != null ? String(item.asking_price) : '');
    setTradeWants(item.trade_wants ?? '');
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

  const closeDetail = () => {
    setShowDetailModal(false);
    setDetailPedal(null);
    setRetiredReason(null);
    setListingStatus(null);
    setAskingPrice('');
    navigation.setParams({ openPedalId: undefined });
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
        const status = primaryDebug?.reverbStatus;
        const err = primaryDebug?.reverbError || primaryDebug?.error;
        if (stage) {
          setWishlistError(`No listings found (${stage}${status ? ` ${status}` : ''}${err ? `: ${err}` : ''}).`);
        }
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
      const maybeErr = e as { message?: string; context?: { status?: number; text?: () => Promise<string> } };
      const status = maybeErr?.context?.status;
      let body = '';
      if (maybeErr?.context?.text) {
        try { body = await maybeErr.context.text(); } catch {}
      }
      const msg = maybeErr?.message ?? String(e);
      if (__DEV__) console.warn('[Wishlist listings] exception:', { msg, status, body });
      setWishlistError(`Could not load listings${status ? ` (${status})` : ''}${body ? `: ${body}` : ''}`);
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
      }),
      ...(showRetireSection && {
        listing_status: null,
        asking_price: null,
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
      Alert.alert('Save failed', error.message);
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

  const handlePickPhoto = async (useCamera: boolean) => {
    if (!detailPedal || !session?.user) return;
    const pedalId = detailPedal.id;
    if (useCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow camera access to take a pedal photo.');
        return;
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow photo library access to upload a pedal photo.');
        return;
      }
    }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          quality: 0.85,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 0.85,
        });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setUploadingPhoto(true);
    try {
      const asset = result.assets[0];
      const basePath = `${session.user.id}/pedals/${detailPedal.id}/${Date.now()}`;
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
        .eq('id', detailPedal.id);
      if (updateError) throw updateError;

      const [{ data: signed }, { data: signedThumb }] = await Promise.all([
        supabase.storage.from('user-pedal-photos').createSignedUrl(path, 60 * 60 * 24 * 7),
        supabase.storage.from('user-pedal-photos').createSignedUrl(thumbPath, 60 * 60 * 24 * 7),
      ]);
      const fullUrl = signed?.signedUrl ?? null;
      const thumbUrl = signedThumb?.signedUrl ?? fullUrl;
      if (fullUrl) {
        setDetailUserImageUrl(fullUrl);
        setDetailImageFailed(false);
        // Optimistically update store maps so the userImageUrls effect doesn't wipe the image
        useStore.setState(s => ({
          userImageUrls: { ...s.userImageUrls, [pedalId]: fullUrl },
          userImageThumbUrls: thumbUrl ? { ...s.userImageThumbUrls, [pedalId]: thumbUrl } : s.userImageThumbUrls,
          ownedPedals: s.ownedPedals.map(p => p.id === pedalId ? { ...p, user_image_path: path } : p),
          wishlistPedals: s.wishlistPedals.map(p => p.id === pedalId ? { ...p, user_image_path: path } : p),
          retiredPedals: s.retiredPedals.map(p => p.id === pedalId ? { ...p, user_image_path: path } : p),
        }));
      }
      refreshUserImages(); // non-blocking: updates persistent cache
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not upload photo. Please try again.';
      Alert.alert('Upload failed', message);
    } finally {
      setUploadingPhoto(false);
    }
  };

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
          {totalInvested > 0 && (
            <View style={styles.valueRow}>
              <View style={styles.valuePair}>
                <Text style={styles.valueLabel}>Invested</Text>
                <Text style={styles.valueAmount}>
                  ${totalInvested.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </Text>
              </View>
              {totalMarketValue > 0 && (
                <>
                  <Text style={styles.valueDot}>•</Text>
                  <View style={styles.valuePair}>
                    <Text style={styles.valueLabel}>Est. Value</Text>
                    <Text style={styles.valueAmount}>
                      ~${totalMarketValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
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
                      {totalMarketValue >= totalInvested ? '+' : ''}
                      ${Math.abs(totalMarketValue - totalInvested).toLocaleString('en-US', { maximumFractionDigits: 0 })}
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
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setShowAddModal(true);
            }}
          >
            <LinearGradient
              colors={
                activeTab === 'wishlist' ? [colors.rose, colors.roseDark] :
                activeTab === 'listed'   ? [colors.gold, colors.goldDark] :
                gradients.teal
              }
              style={styles.actionFullCard}
            >
              <Ionicons name="add-circle" size={20} color="#fff" />
              <Text style={styles.actionHalfTitle}>Add a Pedal</Text>
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
        onClose={() => setShowAddModal(false)}
        onAdded={(brand, model, isOwned) => {
          setShowAddModal(false);
          fetchPedals();
          if (isOwned && brand && model) showShareNudge(brand, model);
        }}
        session={session}
        defaultTab={activeTab}
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
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {detailPedal?.pedal ? `${detailPedal.pedal.brand} ${detailPedal.pedal.model}` : 'Edit Pedal'}
              </Text>
              <TouchableOpacity onPress={closeDetail} activeOpacity={0.7} style={{ padding: spacing.sm }}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
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
                        <Text style={styles.sectionLabel}>Reverb Listings</Text>
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
                        <Text style={styles.helperText}>{wishlistError}</Text>
                      ) : wishlistListings.length === 0 ? (
                        <Text style={styles.helperText}>No listings found right now.</Text>
                      ) : (
                        <View style={styles.wishlistList}>
                          {wishlistListings.map((l, idx) => (
                            <TouchableOpacity
                              key={`${l.title}-${idx}`}
                              style={styles.wishlistRow}
                              activeOpacity={0.8}
                              onPress={() => {
                                if (l.url) Linking.openURL(reverbAffiliateUrl(l.url));
                              }}
                            >
                              <View style={styles.wishlistTextBlock}>
                                <Text style={styles.wishlistTitle} numberOfLines={2}>{l.title}</Text>
                                <Text style={styles.wishlistMeta}>
                                  {l.condition ? `${l.condition} • ` : ''}
                                  {l.date ?? 'Date unknown'}
                                </Text>
                              </View>
                              <Text style={styles.wishlistPrice}>
                                {l.price != null ? `${l.currency ?? '$'}${Math.round(l.price)}` : '—'}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
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
                                    <Text style={styles.gearJourneyPLAmount}>${paid.toLocaleString()}</Text>
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
                                    <Text style={styles.gearJourneyPLAmount}>${sold.toLocaleString()}</Text>
                                  </View>
                                )}
                                {net !== null && (
                                  <View style={[styles.gearJourneyNetBadge, {
                                    backgroundColor: net >= 0 ? colors.teal + '20' : colors.rose + '20',
                                  }]}>
                                    <Text style={[styles.gearJourneyNetText, {
                                      color: net >= 0 ? colors.teal : colors.rose,
                                    }]}>
                                      {net >= 0 ? '+' : ''}${net.toLocaleString()}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            )}
                          </View>
                        );
                      })()}

                      <View style={styles.detailImageRow}>
                {detailUserImageUrl && !detailImageFailed ? (
                  <Image
                    source={{ uri: detailUserImageUrl }}
                    style={styles.detailImage}
                    onError={() => setDetailImageFailed(true)}
                  />
                ) : detailPedal?.pedal?.image_url ? (
                  <Image source={{ uri: detailPedal.pedal.image_url }} style={styles.detailImage} />
                ) : (
                  <View style={styles.detailImageFallback}>
                    <Ionicons name="image-outline" size={22} color={colors.textMuted} />
                    <Text style={styles.detailImageFallbackText}>No photo</Text>
                  </View>
                )}
                  <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    <TouchableOpacity
                      style={styles.detailPhotoBtn}
                      onPress={() => handlePickPhoto(true)}
                      activeOpacity={0.8}
                      disabled={uploadingPhoto}
                    >
                      {uploadingPhoto ? (
                        <ActivityIndicator color={colors.teal} />
                      ) : (
                        <>
                          <Ionicons name="camera-outline" size={18} color={colors.teal} />
                          <Text style={styles.detailPhotoBtnText}>Take Photo</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.detailPhotoBtn}
                      onPress={() => handlePickPhoto(false)}
                      activeOpacity={0.8}
                      disabled={uploadingPhoto}
                    >
                      {uploadingPhoto ? (
                        <ActivityIndicator color={colors.teal} />
                      ) : (
                        <>
                          <Ionicons name="images-outline" size={18} color={colors.teal} />
                          <Text style={styles.detailPhotoBtnText}>Choose Photo</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
              </View>

              {detailPedal?.status === 'owned' && (
                <View style={styles.toggleRow}>
                  <Text style={styles.fieldLabel}>On pedalboard</Text>
                  <View style={styles.boardStatusValue}>
                    <View
                      style={[
                        styles.boardStatusDot,
                        { backgroundColor: detailBoard ? (boardColorMap[detailBoard.color ?? 'teal'] ?? colors.teal) : colors.border },
                      ]}
                    />
                    <Text style={styles.boardStatusText}>
                      {detailBoard ? detailBoard.name : 'None'}
                    </Text>
                  </View>
                </View>
              )}

              {detailPedal?.status === 'owned' && !showRetireSection && (
                <>
                  <Text style={styles.sectionLabel}>For Sale / For Trade</Text>
                  <View style={styles.segmentedRow}>
                    {([null, 'for_sale', 'for_trade', 'for_sale_or_trade'] as const).map(opt => (
                      <TouchableOpacity
                        key={String(opt)}
                        style={[styles.segmentedButton, listingStatus === opt && styles.segmentedButtonActive]}
                        onPress={() => { Haptics.selectionAsync(); setListingStatus(opt); }}
                      >
                        <Text style={[styles.segmentedText, listingStatus === opt && styles.segmentedTextActive]}>
                          {opt === null ? 'Not Listed' : opt === 'for_sale' ? 'For Sale' : opt === 'for_trade' ? 'For Trade' : 'FS+FT'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {(listingStatus === 'for_sale' || listingStatus === 'for_sale_or_trade') && (
                    <TextInput
                      style={styles.detailInput}
                      placeholder="Asking price"
                      keyboardType="decimal-pad"
                      value={askingPrice}
                      onChangeText={setAskingPrice}
                      placeholderTextColor={colors.textMuted}
                    />
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

              <Text style={styles.fieldLabel}>Colorway</Text>
              {detailColorways.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.colorwayList}
                >
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
                      ) : (
                        <Text style={styles.helperText}>No colorways found for this pedal.</Text>
                      )}

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
                                          💰 Paid {node.purchase_price != null ? `$${node.purchase_price}` : '—'}
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
                                    <Text style={styles.traceTotalValue}>${total.toFixed(0)}</Text>
                                  </View>
                                ) : null;
                              })()}
                            </>
                          ) : pedalChain.length === 1 && pedalChain[0].acquired_method === 'purchase' ? (
                            <View style={styles.traceCard}>
                              <Text style={styles.traceCardMeta}>
                                💰 Purchased for {pedalChain[0].purchase_price != null ? `$${pedalChain[0].purchase_price}` : '—'}
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
                                            <Text style={styles.resultPrice}>~${r.avg_price}</Text>
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
          </View>
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
          <View style={styles.collectionModalSheet}>
            {/* Handle */}
            <View style={styles.collectionModalHandle} />

            {/* Header */}
            <View style={styles.collectionModalHeader}>
              <Text style={styles.collectionModalTitle}>{shareSource === 'gas' ? 'Share My GAS List' : 'Share My Collection'}</Text>
              <TouchableOpacity onPress={() => setShareConfigOpen(false)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
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
                  { key: 'market', label: '~Market'    },
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

            {/* Save all pages to Photos — only shown when multiple pages */}
            {totalCollectionPages > 1 && shareFilteredPedals.length > 0 && (
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
            )}
          </View>
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

function AddPedalModal({ visible, onClose, onAdded, session, defaultTab }: AddPedalModalProps) {
  const ownedPedals = useStore(s => s.ownedPedals);
  const profile = useStore(s => s.profile);
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
  const [isUpsertingManual, setIsUpsertingManual] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setAcquisitionType(defaultTab === 'wishlist' ? 'wishlist' : 'bought');
    }
  }, [defaultTab, visible]);

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

  const handleSelectPedal = async (pedal: Pedal) => {
    Haptics.selectionAsync();
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

  const FREE_VAULT_LIMIT = 10;

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

    // Free tier vault cap
    if (status === 'owned' && !profile?.is_premium && !hasBetaFullAccess() && ownedPedals.length >= FREE_VAULT_LIMIT) {
      setAddError(`Free accounts are limited to ${FREE_VAULT_LIMIT} pedals. Upgrade to Pro for unlimited vault access.`);
      return;
    }

    setIsAdding(true);
    setAddError('');

    try {
      // Check for duplicate (retired allows multiples — users can re-own/re-sell)
      const { data: existing } = await supabase
        .from('user_pedals')
        .select('id')
        .eq('user_id', liveSession.user.id)
        .eq('pedal_id', selectedPedal.id)
        .eq('status', status)
        .maybeSingle();

      if (existing) {
        setAddError('You already have this pedal in your ' + status + ' list.');
        return;
      }

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
        const { error: insertError } = await supabase.from('user_pedals').insert({
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
        });
        if (insertError) error = insertError;
      }

      if (error) {
        setAddError(error.message);
        Alert.alert('Save failed', error.message);
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
      setAddError(error.message);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onAdded(selectedPedal?.brand, selectedPedal?.model, false); // retired — no owned share nudge
      handleClose();
    }
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
    setSearch('');
    setResults([]);
    setReverbResults([]);
    setSelectedPedal(null);
    setColorways([]);
    setSelectedColorwayId(null);
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
    onClose();
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <TouchableOpacity style={styles.modalBackdrop} onPress={handleClose} activeOpacity={1} />
        <View style={styles.modalSheet}>
          {/* Handle */}
          <View style={styles.modalHandle} />

          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Pedal</Text>
            <TouchableOpacity onPress={handleClose} activeOpacity={0.7} style={{ padding: spacing.sm }}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
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
              autoFocus={!selectedPedal}
            />
            {isSearching && <ActivityIndicator size="small" color={colors.teal} />}
          </View>

          {/* Results or selected pedal */}
          {selectedPedal ? (
            <ScrollView
              style={styles.selectedPedalWrap}
              contentContainerStyle={styles.selectedPedalContent}
              ref={detailScrollRef}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.selectedPedal}>
                <View style={styles.selectedPedalInfo}>
                  <CategoryBadge category={selectedPedal.category} small />
                  <Text style={styles.selectedPedalBrand}>{selectedPedal.brand}</Text>
                  <Text style={styles.selectedPedalModel}>{selectedPedal.model}</Text>
                  {selectedPedal.avg_price && (
                    <Text style={styles.selectedPedalPrice}>~${selectedPedal.avg_price}</Text>
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
            </ScrollView>
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

              {/* Catalog results */}
              {results.map(pedal => (
                <TouchableOpacity
                  key={pedal.id}
                  style={styles.resultRow}
                  onPress={() => handleSelectPedal(pedal)}
                  activeOpacity={0.7}
                >
                  <View style={styles.resultRowContent}>
                    <View style={styles.resultRowText}>
                      <Text style={styles.resultBrand}>{pedal.brand}</Text>
                      <Text style={styles.resultModel}>{pedal.model}</Text>
                    </View>
                    <View style={styles.resultRowRight}>
                      <CategoryBadge category={pedal.category} small />
                      {pedal.avg_price && (
                        <Text style={styles.resultPrice}>${pedal.avg_price}</Text>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              ))}

              {/* Reverb-sourced results not yet in catalog */}
              {reverbResults.length > 0 && (
                <>
                  {results.length > 0 && (
                    <View style={styles.reverbDivider}>
                      <Text style={styles.reverbDividerText}>Also found on Reverb</Text>
                    </View>
                  )}
                  {reverbResults.map((r, i) => (
                    <TouchableOpacity
                      key={`reverb-${i}`}
                      style={styles.resultRow}
                      onPress={() => handleSelectReverbResult(r)}
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
                            <Text style={styles.resultPrice}>~${r.avg_price}</Text>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </ScrollView>
          )}
        </View>
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
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.base,
    paddingRight: spacing.lg,
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
  },
  resultRowText: {
    flex: 1,
    marginRight: spacing.md,
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
});
