export type RootStackParamList = {
  Main: undefined;
  Admin: undefined;
  Profile: undefined;
};

export type TabParamList = {
  Home: undefined;
  Vault: { initialTab?: 'owned' | 'wishlist' | 'retired'; openPedalId?: string; openAddModal?: boolean } | undefined;
  Videos: undefined;
  Boards: undefined;
  'TPC.ai': undefined;
};

export type HomeStackParamList = {
  HomeMain: undefined;
  Finder: undefined;
};

export type BoardsStackParamList = {
  BoardsMain: undefined;
  BoardDetail: { boardId: string };
};

export type AIStackParamList = {
  AIHub: undefined;
  Advisor: undefined;
  Finder: undefined;
};
