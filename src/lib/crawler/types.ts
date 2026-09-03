export type PageType =
  | "top"
  | "company"
  | "business"
  | "recruit"
  | "recruit_new_graduate"
  | "recruit_mid_career"
  | "job_listing"
  | "news"
  | "employee"
  | "message"
  | "contact"
  | "privacy"
  | "other";

export interface CrawledPage {
  url: string;
  pageType: PageType;
  title: string | null;
  text: string;
  httpStatus: number;
  links: ExtractedLink[];
  emails: string[];
  phones: string[];
  hasForm: boolean;
}

export interface ExtractedLink {
  url: string;
  text: string;
}

export interface SocialLinks {
  instagram_url: string | null;
  facebook_url: string | null;
  x_url: string | null;
  youtube_url: string | null;
  linkedin_url: string | null;
  tiktok_url: string | null;
}

export interface SalesRestrictionHit {
  text: string;
  sourceUrl: string;
  pattern: string;
  /** ルールベースの確信度 (0-100) */
  confidence: number;
}

export interface CrawlSummary {
  pages: CrawledPage[];
  emails: string[];
  phones: string[];
  social: SocialLinks;
  contactPageUrl: string | null;
  contactFormUrl: string | null;
  recruitPageUrl: string | null;
  salesRestrictions: SalesRestrictionHit[];
  robotsBlocked: boolean;
  fetchedCount: number;
  skippedCount: number;
  errors: string[];
}
