import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Linking,
  RefreshControl,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, gradients } from '../theme';
import { supabase, invokeEdgeFunction } from '../lib/supabase';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_ID   = 'UCatp9V-Jx2KayYer0y052kw';
const CHANNEL_URL  = `https://www.youtube.com/channel/${CHANNEL_ID}?sub_confirmation=1`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface YoutubeVideo {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  channelTitle: string;
}

interface FetchResult {
  videos: YoutubeVideo[];
  nextPageToken: string | null;
  totalResults: number;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function openVideo(id: string) {
  Linking.openURL(`https://www.youtube.com/watch?v=${id}`).catch(() => {});
}

// ─── Featured Hero Card ────────────────────────────────────────────────────────

function FeaturedCard({ video }: { video: YoutubeVideo }) {
  return (
    <TouchableOpacity
      style={styles.featuredCard}
      activeOpacity={0.8}
      onPress={() => openVideo(video.id)}
    >
      <View style={styles.featuredThumbWrapper}>
        {video.thumbnail ? (
          <Image source={{ uri: video.thumbnail }} style={styles.featuredThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.featuredThumb, styles.thumbnailPlaceholder]}>
            <Ionicons name="play-circle" size={48} color={colors.textMuted} />
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.7)']}
          style={styles.featuredGradient}
        />
        <View style={styles.featuredLabel}>
          <Ionicons name="logo-youtube" size={14} color="#FF0000" />
          <Text style={styles.featuredLabelText}>THIS WEEK ON TPC</Text>
        </View>
        <View style={styles.featuredPlayBtn}>
          <Ionicons name="play" size={20} color="#fff" />
        </View>
      </View>
      <View style={styles.featuredBody}>
        <Text style={styles.featuredTitle} numberOfLines={2}>{video.title}</Text>
        <Text style={styles.featuredDate}>{formatDate(video.publishedAt)}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── VideoCard ────────────────────────────────────────────────────────────────

function VideoCard({ video }: { video: YoutubeVideo }) {
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.75}
      onPress={() => openVideo(video.id)}
    >
      <View style={styles.thumbnailWrapper}>
        {video.thumbnail ? (
          <Image source={{ uri: video.thumbnail }} style={styles.thumbnail} resizeMode="cover" />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
            <Ionicons name="play-circle" size={36} color={colors.textMuted} />
          </View>
        )}
        {/* Play overlay */}
        <View style={styles.playBadge}>
          <Ionicons name="logo-youtube" size={18} color="#FF0000" />
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.videoTitle} numberOfLines={2}>{video.title}</Text>
        <Text style={styles.videoDate}>{formatDate(video.publishedAt)}</Text>
        {video.description ? (
          <Text style={styles.videoDesc} numberOfLines={2}>{video.description}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function VideosScreen() {
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [videos, setVideos] = useState<YoutubeVideo[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentQueryRef = useRef('');

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchVideos = useCallback(async (
    searchQuery: string,
    pageToken: string | null,
    isAppend: boolean,
  ) => {
    if (!isAppend) {
      setError(null);
    }

    try {
      const body: Record<string, string> = { query: searchQuery };
      if (pageToken) body.pageToken = pageToken;

      const { data, error: fnError } = await invokeEdgeFunction('youtube-videos', body);

      if (fnError) {
        setError('Could not load videos. Check your connection and try again.');
        return;
      }

      const result = data as FetchResult;

      if (result.error) {
        setError(result.error);
        return;
      }

      if (isAppend) {
        setVideos(prev => [...prev, ...(result.videos ?? [])]);
      } else {
        setVideos(result.videos ?? []);
      }
      setNextPageToken(result.nextPageToken ?? null);
    } catch {
      setError('Something went wrong. Please try again.');
    }
  }, []);

  // ── Initial load ───────────────────────────────────────────────────────────

  useEffect(() => {
    setIsLoading(true);
    fetchVideos('', null, false).finally(() => setIsLoading(false));
  }, [fetchVideos]);

  // ── Search with debounce ───────────────────────────────────────────────────

  const handleSearchChange = useCallback((text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      const safe = text.trim();
      currentQueryRef.current = safe;
      setIsLoading(true);
      setVideos([]);
      setNextPageToken(null);
      await fetchVideos(safe, null, false);
      setIsLoading(false);
    }, 500);
  }, [fetchVideos]);

  const handleClearSearch = useCallback(() => {
    setQuery('');
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    currentQueryRef.current = '';
    setIsLoading(true);
    setVideos([]);
    setNextPageToken(null);
    fetchVideos('', null, false).finally(() => setIsLoading(false));
  }, [fetchVideos]);

  // ── Pull to refresh ────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setNextPageToken(null);
    await fetchVideos(currentQueryRef.current, null, false);
    setIsRefreshing(false);
  }, [fetchVideos]);

  // ── Load more ──────────────────────────────────────────────────────────────

  const handleLoadMore = useCallback(async () => {
    if (!nextPageToken || isLoadingMore) return;
    setIsLoadingMore(true);
    await fetchVideos(currentQueryRef.current, nextPageToken, true);
    setIsLoadingMore(false);
  }, [nextPageToken, isLoadingMore, fetchVideos]);

  // ── Derived: featured vs rest ──────────────────────────────────────────────

  const featuredVideo  = !query && videos.length > 0 ? videos[0] : null;
  const listVideos     = !query && videos.length > 0 ? videos.slice(1) : videos;

  // ── Render ─────────────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item }: { item: YoutubeVideo }) => (
    <VideoCard video={item} />
  ), []);

  const renderHeader = () => {
    if (isLoading || !featuredVideo) return null;
    return (
      <View style={styles.listHeader}>
        <FeaturedCard video={featuredVideo} />
        {/* Subscribe CTA */}
        <TouchableOpacity
          style={styles.subscribeBanner}
          activeOpacity={0.8}
          onPress={() => Linking.openURL(CHANNEL_URL).catch(() => {})}
        >
          <View style={styles.subscribeBannerLeft}>
            <Ionicons name="logo-youtube" size={20} color="#FF0000" />
            <View>
              <Text style={styles.subscribeBannerTitle}>The Pedal Collaborative</Text>
              <Text style={styles.subscribeBannerSub}>New videos every week</Text>
            </View>
          </View>
          <View style={styles.subscribeBtn}>
            <Text style={styles.subscribeBtnText}>Subscribe</Text>
          </View>
        </TouchableOpacity>
        {listVideos.length > 0 && (
          <Text style={styles.moreEpisodesLabel}>More Episodes</Text>
        )}
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyState}>
        <Ionicons name="logo-youtube" size={48} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>
          {error ? 'Couldn\'t load videos' : query ? 'No videos found' : 'No videos yet'}
        </Text>
        <Text style={styles.emptyBody}>
          {error
            ? error
            : query
            ? `No results for "${query}" on this channel`
            : 'Check back soon for new content!'}
        </Text>
        {error && (
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setIsLoading(true);
              setError(null);
              fetchVideos(currentQueryRef.current, null, false).finally(() => setIsLoading(false));
            }}
          >
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderFooter = () => {
    if (!isLoadingMore) return <View style={{ height: 32 }} />;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.teal} />
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <LinearGradient colors={gradients.header} style={styles.header}>
        <View style={styles.headerTop}>
          <Ionicons name="logo-youtube" size={22} color="#FF0000" style={{ marginRight: 8 }} />
          <Text style={styles.headerTitle}>Videos</Text>
        </View>
        <Text style={styles.headerSub}>The Pedal Collaborative</Text>

        {/* ── Search bar ── */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={colors.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search videos…"
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={handleSearchChange}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={handleClearSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </LinearGradient>

      {/* ── Video list ── */}
      {isLoading && videos.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.teal} />
          <Text style={styles.loadingText}>Loading videos…</Text>
        </View>
      ) : (
        <FlatList
          data={listVideos}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={[
            styles.listContent,
            listVideos.length === 0 && !featuredVideo && styles.listContentEmpty,
          ]}
          ListEmptyComponent={!featuredVideo ? renderEmpty : null}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.teal}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const FEATURED_HEIGHT = 220;
const THUMB_HEIGHT = 180;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Header
  header: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.md,
  },
  headerTitle: {
    fontFamily: typography.display,
    fontSize: typography.sizes.xl,
    color: colors.textPrimary,
  },
  headerSub: {
    fontFamily: typography.body,
    fontSize: typography.sizes.sm,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.md,
  },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 40,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontFamily: typography.body,
    fontSize: typography.sizes.sm,
    color: colors.textMuted,
  },

  // List
  listContent: {
    padding: spacing.base,
    gap: spacing.md,
  },
  listContentEmpty: {
    flex: 1,
  },
  listHeader: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },

  // Featured card
  featuredCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  featuredThumbWrapper: {
    position: 'relative',
  },
  featuredThumb: {
    width: '100%',
    height: FEATURED_HEIGHT,
    backgroundColor: colors.surfaceHigh,
  },
  featuredGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: FEATURED_HEIGHT * 0.6,
  },
  featuredLabel: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  featuredLabelText: {
    fontFamily: typography.bodySemiBold,
    fontSize: typography.sizes.xs,
    color: '#fff',
    letterSpacing: 0.6,
  },
  featuredPlayBtn: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredBody: {
    padding: spacing.md,
    gap: 4,
  },
  featuredTitle: {
    fontFamily: typography.bodySemiBold,
    fontSize: typography.sizes.md,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  featuredDate: {
    fontFamily: typography.body,
    fontSize: typography.sizes.xs,
    color: colors.textMuted,
  },

  // Subscribe banner
  subscribeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  subscribeBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  subscribeBannerTitle: {
    fontFamily: typography.bodySemiBold,
    fontSize: typography.sizes.sm,
    color: colors.textPrimary,
  },
  subscribeBannerSub: {
    fontFamily: typography.body,
    fontSize: typography.sizes.xs,
    color: colors.textMuted,
    marginTop: 1,
  },
  subscribeBtn: {
    backgroundColor: '#FF0000',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  subscribeBtnText: {
    fontFamily: typography.bodySemiBold,
    fontSize: typography.sizes.sm,
    color: '#fff',
  },

  // Section label
  moreEpisodesLabel: {
    fontFamily: typography.bodySemiBold,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    letterSpacing: 0.3,
    marginTop: spacing.xs,
  },

  // Video card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  thumbnailWrapper: {
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: THUMB_HEIGHT,
    backgroundColor: colors.surfaceHigh,
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  cardBody: {
    padding: spacing.md,
    gap: 4,
  },
  videoTitle: {
    fontFamily: typography.bodySemiBold,
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
    lineHeight: 21,
  },
  videoDate: {
    fontFamily: typography.body,
    fontSize: typography.sizes.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  videoDesc: {
    fontFamily: typography.body,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 19,
    marginTop: 4,
  },

  // Footer loader
  footerLoader: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontFamily: typography.bodySemiBold,
    fontSize: typography.sizes.md,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  emptyBody: {
    fontFamily: typography.body,
    fontSize: typography.sizes.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: spacing.md,
    backgroundColor: colors.teal,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  retryText: {
    fontFamily: typography.bodySemiBold,
    fontSize: typography.sizes.sm,
    color: '#fff',
  },
});
