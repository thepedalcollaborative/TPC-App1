export type RootStackParamList = {
  Main: undefined;
  Admin: undefined;
  Profile: undefined;
  GearHistory: undefined;
  ChatHistory: undefined;
  Legal: { tab?: 'privacy' | 'terms' } | undefined;
  PublicProfile: { username: string };
};

export type TabParamList = {
  Home: undefined;
  Vault: { initialTab?: 'owned' | 'wishlist' | 'listed'; openPedalId?: string; openAddModal?: boolean; triggerScan?: 'camera' | 'library' } | undefined;
  Videos: undefined;
  Boards: undefined;
  'TPC.ai': undefined;
};

export type HomeStackParamList = {
  HomeMain: undefined;
  Finder: { startMode?: 'expert' } | undefined;
};

export type BoardsStackParamList = {
  BoardsMain: undefined;
  BoardDetail: { boardId: string };
};

export type AIStackParamList = {
  AIHub: undefined;
  Advisor: { conversationId?: string } | undefined;
  Finder: { startMode?: 'expert' } | undefined;
};
