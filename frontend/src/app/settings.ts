import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Api, AICredits, AIUsage } from './api';
import { errorMessage } from './api-error';
import { AuthSession } from './auth-session';
import { blockedReason, isLowRemaining } from './ai-credits-state';
import {
  displayLimit,
  displayPeriod,
  displayRemaining,
} from './ai-credits-display';
import { parseLimitTokens } from './ai-credits-limit-parse';
import {
  AI_CREDITS_APPROXIMATE_NOTE,
  AI_CREDITS_EXHAUSTED_ADMIN,
  AI_CREDITS_EXHAUSTED_MEMBER,
  AI_CREDITS_LIMIT_INVALID,
} from './ai-credits-settings-copy';
import { AI_LOW_REMAINING_MESSAGE } from './ai-unavailable-copy';

@Component({
  selector: 'app-settings',
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class SettingsPage implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthSession);
  private readonly destroyRef = inject(DestroyRef);

  private usageGeneration = 0;
  private creditsGeneration = 0;
  private saveGeneration = 0;

  readonly loading = signal(true);
  readonly error = signal('');
  readonly usage = signal<AIUsage | null>(null);

  readonly creditsLoading = signal(true);
  readonly creditsError = signal('');
  readonly credits = signal<AICredits | null>(null);

  readonly draftUnlimited = signal(false);
  readonly draftLimit = signal('');
  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly clientError = signal('');

  readonly lowRemainingMessage = AI_LOW_REMAINING_MESSAGE;
  readonly approximateNote = AI_CREDITS_APPROXIMATE_NOTE;
  readonly exhaustedAdminMessage = AI_CREDITS_EXHAUSTED_ADMIN;
  readonly exhaustedMemberMessage = AI_CREDITS_EXHAUSTED_MEMBER;

  readonly displayRemaining = displayRemaining;
  readonly displayLimit = displayLimit;
  readonly displayPeriod = displayPeriod;

  readonly lowRemaining = computed(() => isLowRemaining(this.credits()));
  readonly creditBlockReason = computed(() => blockedReason(this.credits()));

  get isAdmin() {
    return this.auth.isAdmin();
  }

  ngOnInit() {
    this.reload();
  }

  reload() {
    this.reloadUsage();
    this.reloadCredits();
  }

  reloadUsage() {
    const generation = ++this.usageGeneration;
    this.loading.set(true);
    this.error.set('');
    this.api
      .getAIUsage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (usage) => {
          if (generation !== this.usageGeneration) return;
          this.usage.set(usage);
          this.loading.set(false);
        },
        error: (err) => {
          if (generation !== this.usageGeneration) return;
          this.error.set(errorMessage(err));
          this.loading.set(false);
        },
      });
  }

  reloadCredits() {
    const generation = ++this.creditsGeneration;
    this.creditsLoading.set(true);
    this.creditsError.set('');
    this.api
      .getAICredits()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (credits) => {
          if (generation !== this.creditsGeneration) return;
          this.credits.set(credits);
          this.syncDraft(credits);
          this.creditsLoading.set(false);
        },
        error: (err) => {
          if (generation !== this.creditsGeneration) return;
          this.creditsError.set(errorMessage(err));
          this.creditsLoading.set(false);
        },
      });
  }

  onUnlimitedChange(checked: boolean) {
    this.draftUnlimited.set(checked);
    this.clientError.set('');
    if (checked) this.draftLimit.set('');
  }

  onLimitInput(value: string) {
    this.draftLimit.set(value);
    this.clientError.set('');
  }

  saveCredits() {
    if (!this.isAdmin || this.saving()) return;
    this.clientError.set('');
    this.saveError.set('');

    let body: { limitTokens: number | null };
    if (this.draftUnlimited()) {
      body = { limitTokens: null };
    } else {
      const n = parseLimitTokens(this.draftLimit());
      if (n == null) {
        this.clientError.set(AI_CREDITS_LIMIT_INVALID);
        return;
      }
      body = { limitTokens: n };
    }

    const generation = ++this.saveGeneration;
    this.saving.set(true);
    this.api
      .putAICredits(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (generation !== this.saveGeneration) return;
          this.credits.set(res);
          this.syncDraft(res);
          this.saveError.set('');
          this.saving.set(false);
        },
        error: (err) => {
          if (generation !== this.saveGeneration) return;
          this.saveError.set(errorMessage(err));
          this.saving.set(false);
        },
      });
  }

  private syncDraft(c: AICredits) {
    if (c.unlimited) {
      this.draftUnlimited.set(true);
      this.draftLimit.set('');
    } else {
      this.draftUnlimited.set(false);
      this.draftLimit.set(c.limitTokens == null ? '' : String(c.limitTokens));
    }
  }
}
