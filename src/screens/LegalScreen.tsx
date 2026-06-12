import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme';
import type { RootStackParamList } from '../types/navigation';

type LegalRouteProp = RouteProp<RootStackParamList, 'Legal'>;

const EFFECTIVE_DATE = 'May 1, 2026';
const CONTACT_EMAIL  = 'support@thepedalcollaborative.com';
const APP_NAME       = 'The Pedal Collaborative';

// ─── Privacy Policy ───────────────────────────────────────────────────────────
const PRIVACY_SECTIONS = [
  {
    title: '1. Information We Collect',
    body: `When you create an account and use ${APP_NAME}, we collect information you provide directly:\n\n• Account information — email address, display name, and optional username when you register.\n• Collection data — the pedals you add to your vault, wishlist, boards, and notes you attach to them.\n• Photos — images you upload or capture to represent your gear.\n• Tone and gear preferences — onboarding answers and expert-mode settings you choose.\n• Usage information — how you interact with features such as the AI Advisor, Pedal Finder, and boards.\n• Community activity — pedals you add to your vault or wishlist are counted anonymously to power community trend features (e.g., "5 members added this"). You can opt out of contributing to these counts at any time in your Profile settings. Counts are always anonymous — your name is never shown.\n\nWe also collect certain information automatically:\n\n• Device identifiers and operating system version for crash reporting and compatibility.\n• Anonymous analytics to understand which features are used most.`,
  },
  {
    title: '2. How We Use Your Information',
    body: `We use the information we collect to:\n\n• Provide, maintain, and improve the app and its features.\n• Personalize the AI Advisor and Pedal Finder recommendations using your collection and tone profile.\n• Send important service communications (e.g., subscription confirmations, security notices).\n• Detect and prevent fraud, abuse, or unauthorized access.\n• Comply with legal obligations.`,
  },
  {
    title: '3. Third-Party Services',
    body: `${APP_NAME} relies on the following third-party services to operate. Each has its own privacy policy:\n\n• Supabase — database hosting and authentication (supabase.com/privacy)\n• Anthropic — powers the AI Advisor feature (anthropic.com/privacy)\n• RevenueCat — manages in-app subscriptions (revenuecat.com/privacy)\n• Apple — Sign in with Apple authentication (apple.com/privacy)\n• Patreon — optional membership connection (patreon.com/privacy)\n\nWe do not sell your personal information to any third party.`,
  },
  {
    title: '4. Data Sharing',
    body: `We do not sell, trade, or rent your personal information. We may share information only in these limited circumstances:\n\n• With service providers listed in Section 3 who process data on our behalf.\n• If required by law, court order, or governmental authority.\n• To protect the rights, property, or safety of ${APP_NAME}, our users, or the public.\n• In connection with a merger, acquisition, or sale of all or a portion of our assets (you will be notified).`,
  },
  {
    title: '5. Data Retention & Deletion',
    body: `We retain your data for as long as your account is active. You can delete your account at any time from Profile → Delete Account. Upon deletion, your profile and collection data are permanently removed from our servers within 30 days.\n\nPhotos you uploaded are removed from cloud storage within 30 days of account deletion.`,
  },
  {
    title: '6. Children\'s Privacy',
    body: `${APP_NAME} is not directed to children under 13 years of age. We do not knowingly collect personal information from children under 13. If we learn we have inadvertently collected such information, we will delete it promptly. If you believe a child has provided us personal information, please contact us at ${CONTACT_EMAIL}.`,
  },
  {
    title: '7. Security',
    body: `We use industry-standard measures to protect your information, including encrypted data transmission (TLS), row-level security policies on our database, and access controls on all cloud infrastructure. No method of transmission over the Internet is 100% secure, however, and we cannot guarantee absolute security.`,
  },
  {
    title: '8. Changes to This Policy',
    body: `We may update this Privacy Policy from time to time. When we do, we will update the effective date at the top of this screen. For material changes we will provide additional notice within the app. Continued use of ${APP_NAME} after changes take effect constitutes your acceptance of the revised policy.`,
  },
  {
    title: '9. Contact Us',
    body: `If you have questions or concerns about this Privacy Policy or your personal data, please contact us at:\n\n${CONTACT_EMAIL}`,
  },
];

// ─── Terms of Service ─────────────────────────────────────────────────────────
const TERMS_SECTIONS = [
  {
    title: '1. Acceptance of Terms',
    body: `By downloading, installing, or using ${APP_NAME} ("the App"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the App. These Terms apply to all users including free and paid subscribers.`,
  },
  {
    title: '2. Description of Service',
    body: `${APP_NAME} is a mobile application that allows musicians and gear enthusiasts to catalog their pedal collections, track gear history, receive AI-powered recommendations, and share gear lists. Certain features require a paid Pro subscription.`,
  },
  {
    title: '3. Account Registration',
    body: `You must be at least 13 years old to create an account. You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. Notify us immediately at ${CONTACT_EMAIL} if you suspect unauthorized access to your account.`,
  },
  {
    title: '4. Subscriptions and Payments',
    body: `Pro features are available through an auto-renewing subscription purchased via Apple's In-App Purchase system or Patreon membership. Subscriptions automatically renew unless cancelled at least 24 hours before the end of the current period. You can manage and cancel subscriptions in your Apple ID Account Settings. We do not process payments directly — all billing is handled by Apple or Patreon under their respective terms. Refunds are governed by Apple's refund policy.`,
  },
  {
    title: '5. User Content',
    body: `You retain ownership of content you create in the App, including collection data and photos. By uploading content you grant ${APP_NAME} a limited, non-exclusive, royalty-free license to store and display that content solely to provide the service to you. You represent that you have the rights to any content you upload and that it does not violate any third-party rights or applicable law.`,
  },
  {
    title: '6. Acceptable Use',
    body: `You agree not to:\n\n• Use the App for any unlawful purpose or in violation of any applicable regulation.\n• Attempt to gain unauthorized access to any part of the App or its infrastructure.\n• Reverse engineer, decompile, or disassemble any part of the App.\n• Use automated scripts or bots to access the App.\n• Upload content that is defamatory, obscene, or infringes any intellectual property rights.\n• Circumvent any subscription or usage limits.`,
  },
  {
    title: '7. AI Features',
    body: `The AI Advisor and Pedal Finder features are provided for informational and entertainment purposes only. Recommendations are generated by artificial intelligence and may not always be accurate or suitable for your specific needs. ${APP_NAME} makes no warranty regarding the accuracy or completeness of AI-generated content. Do not rely solely on AI recommendations for significant purchasing decisions.`,
  },
  {
    title: '8. Intellectual Property',
    body: `${APP_NAME} and its original content, features, and functionality are owned by The Pedal Collaborative and are protected by applicable intellectual property laws. Pedal names, brand names, and trademarks referenced in the App belong to their respective owners and are used for identification purposes only.`,
  },
  {
    title: '9. Disclaimer of Warranties',
    body: `THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE APP WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS.`,
  },
  {
    title: '10. Limitation of Liability',
    body: `TO THE FULLEST EXTENT PERMITTED BY LAW, THE PEDAL COLLABORATIVE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF DATA OR PROFITS, ARISING OUT OF OR RELATED TO YOUR USE OF THE APP, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE TWELVE MONTHS PRECEDING THE CLAIM.`,
  },
  {
    title: '11. Termination',
    body: `We reserve the right to suspend or terminate your account at our discretion if you violate these Terms. You may delete your account at any time from Profile → Delete Account. Upon termination, your right to use the App ceases immediately.`,
  },
  {
    title: '12. Changes to Terms',
    body: `We may update these Terms from time to time. When we do, we will update the effective date and provide notice within the App for material changes. Continued use of the App after updated Terms are posted constitutes your acceptance.`,
  },
  {
    title: '13. Governing Law',
    body: `These Terms are governed by the laws of the State of California, United States, without regard to conflict of law principles. Any disputes arising from these Terms or your use of the App shall be resolved in the courts located in California.`,
  },
  {
    title: '14. Contact',
    body: `Questions about these Terms? Contact us at:\n\n${CONTACT_EMAIL}`,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function LegalScreen() {
  const navigation = useNavigation();
  const route = useRoute<LegalRouteProp>();
  const [activeTab, setActiveTab] = useState<'privacy' | 'terms'>(
    route.params?.tab ?? 'privacy'
  );

  const sections = activeTab === 'privacy' ? PRIVACY_SECTIONS : TERMS_SECTIONS;
  const title    = activeTab === 'privacy' ? 'Privacy Policy' : 'Terms of Service';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'privacy' && styles.tabActive]}
          onPress={() => setActiveTab('privacy')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === 'privacy' && styles.tabTextActive]}>
            Privacy Policy
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'terms' && styles.tabActive]}
          onPress={() => setActiveTab('terms')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === 'terms' && styles.tabTextActive]}>
            Terms of Service
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.effectiveDate}>Effective: {EFFECTIVE_DATE}</Text>

        {sections.map((section, i) => (
          <View key={i} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40,
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.teal,
  },
  tabText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textMuted,
    fontWeight: '500',
  },
  tabTextActive: {
    color: colors.teal,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
  },
  effectiveDate: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.body,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.bodySemiBold,
    color: colors.textPrimary,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  sectionBody: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
});
