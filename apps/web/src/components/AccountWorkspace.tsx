"use client";

import { FormEvent, useState } from "react";
import {
  AtSign,
  BadgeCheck,
  CalendarDays,
  Globe2,
  Loader2,
  Save,
  UserRound,
} from "lucide-react";

export interface AccountProfile {
  id: string;
  email: string;
  username: string;
  avatar: string | null;
  language: string;
  country: string | null;
  status: string;
  role: string;
  emailVerified: boolean;
  createdAt: string;
  profile: {
    displayName: string | null;
    bio: string | null;
    activity: string | null;
    theme: string;
    subscriptionTier: string;
  } | null;
}

export interface AccountProfileUpdate {
  displayName: string | null;
  bio: string | null;
  activity: string | null;
  language: string;
  country: string | null;
}

interface AccountRailProps {
  profile: AccountProfile | null;
  loading: boolean;
}

const initials = (value: string) => value.slice(0, 2).toUpperCase();

export function AccountRail({ profile, loading }: AccountRailProps) {
  return (
    <>
      <div className="rail-heading account-rail-heading">
        <div>
          <p className="eyebrow">Your identity</p>
          <h2>Account</h2>
        </div>
        <span className="account-rail-icon">
          <UserRound size={18} />
        </span>
      </div>

      {loading && !profile ? (
        <div className="rail-state">
          <Loader2 className="animate-spin" />
          <span>Opening your profile...</span>
        </div>
      ) : profile ? (
        <>
          <section className="account-summary-card">
            <span>
              {initials(profile.profile?.displayName || profile.username)}
            </span>
            <div>
              <strong>
                {profile.profile?.displayName || `@${profile.username}`}
              </strong>
              <small>@{profile.username}</small>
            </div>
          </section>

          <div className="account-facts">
            <span>
              <BadgeCheck size={15} />
              {profile.role.toLowerCase().replaceAll("_", " ")}
            </span>
            <span>
              <Globe2 size={15} />
              {profile.language}
              {profile.country ? ` · ${profile.country}` : ""}
            </span>
            <span>
              <CalendarDays size={15} />
              Joined{" "}
              {new Intl.DateTimeFormat(undefined, {
                month: "short",
                year: "numeric",
              }).format(new Date(profile.createdAt))}
            </span>
          </div>

          <div className="account-plan-card">
            <p className="eyebrow">Current plan</p>
            <strong>
              {profile.profile?.subscriptionTier.toLowerCase() || "free"}
            </strong>
            <small>Profile and account controls</small>
          </div>
        </>
      ) : null}
    </>
  );
}

interface AccountPanelProps {
  profile: AccountProfile | null;
  loading: boolean;
  saving: boolean;
  onSave: (update: AccountProfileUpdate) => Promise<void>;
}

export function AccountPanel({
  profile,
  loading,
  saving,
  onSave,
}: AccountPanelProps) {
  if (loading && !profile) {
    return (
      <div className="account-loading-panel">
        <Loader2 className="animate-spin" />
        <strong>Loading your account</strong>
      </div>
    );
  }

  if (!profile) return null;

  const profileKey = [
    profile.profile?.displayName,
    profile.profile?.bio,
    profile.profile?.activity,
    profile.language,
    profile.country,
  ].join("|");

  return (
    <AccountProfileForm
      key={profileKey}
      profile={profile}
      saving={saving}
      onSave={onSave}
    />
  );
}

interface AccountProfileFormProps {
  profile: AccountProfile;
  saving: boolean;
  onSave: (update: AccountProfileUpdate) => Promise<void>;
}

function AccountProfileForm({
  profile,
  saving,
  onSave,
}: AccountProfileFormProps) {
  const [displayName, setDisplayName] = useState(
    profile.profile?.displayName || "",
  );
  const [bio, setBio] = useState(profile.profile?.bio || "");
  const [activity, setActivity] = useState(profile.profile?.activity || "");
  const [language, setLanguage] = useState(profile.language);
  const [country, setCountry] = useState(profile.country || "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave({
      displayName: displayName.trim() || null,
      bio: bio.trim() || null,
      activity: activity.trim() || null,
      language: language.trim(),
      country: country.trim() ? country.trim().toUpperCase() : null,
    });
  };

  return (
    <div className="account-panel">
      <header className="conversation-header account-header">
        <div>
          <p className="eyebrow">
            <AtSign size={14} /> @{profile.username}
          </p>
          <h2>{profile.profile?.displayName || "Your profile"}</h2>
          <p>{profile.email}</p>
        </div>
        <span className={`account-status is-${profile.status.toLowerCase()}`}>
          <i />
          {profile.status.toLowerCase()}
        </span>
      </header>

      <form className="account-form" onSubmit={submit}>
        <section className="account-form-section">
          <div>
            <p className="eyebrow">Public identity</p>
            <h3>How people see you</h3>
            <p>
              Your username remains fixed. These details add context without
              exposing private account information.
            </p>
          </div>

          <div className="account-fields">
            <label>
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={50}
                placeholder="The name people know you by"
              />
            </label>
            <label>
              Current activity
              <input
                value={activity}
                onChange={(event) => setActivity(event.target.value)}
                maxLength={80}
                placeholder="What are you up to?"
              />
            </label>
            <label className="account-field-wide">
              Bio
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                maxLength={280}
                rows={5}
                placeholder="Share a short introduction."
              />
              <small>{bio.length}/280</small>
            </label>
          </div>
        </section>

        <section className="account-form-section">
          <div>
            <p className="eyebrow">Locale</p>
            <h3>Language and region</h3>
            <p>
              These settings prepare the account for localized rooms and future
              language preferences.
            </p>
          </div>

          <div className="account-fields">
            <label>
              Language code
              <input
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                minLength={2}
                maxLength={10}
                pattern="[a-zA-Z]+(-[a-zA-Z]+)?"
                required
                placeholder="en"
              />
            </label>
            <label>
              Country code
              <input
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                minLength={2}
                maxLength={2}
                pattern="[a-zA-Z]{2}"
                placeholder="PS"
              />
            </label>
          </div>
        </section>

        <div className="account-form-actions">
          <span>
            Email {profile.emailVerified ? "verified" : "not yet verified"}
          </span>
          <button type="submit" disabled={saving}>
            {saving ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              <Save size={17} />
            )}
            Save profile
          </button>
        </div>
      </form>
    </div>
  );
}
