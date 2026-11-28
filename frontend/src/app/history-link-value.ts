import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatItemNumber } from './item-number';
import { fallbackPrLabel } from './pr-display';
import { validPrUrl } from './pr-url';
import { displayLabel, relatedItemKey } from './related-item';
import { parseHistoryLabelNames, renderLinkChange } from './history-link-change';

@Component({
  selector: 'app-history-link-value',
  imports: [RouterLink],
  styleUrl: './history-link-value.css',
  template: `
    @if (renderLinkChange(field, value); as block) {
      @if (block.kind === 'pr') {
        @if (block.urls.length) {
          <ul class="pr-history">
            @for (url of block.urls; track url) {
              <li>
                @if (safePr(url)) {
                  <a [href]="url" [attr.title]="url" target="_blank" rel="noopener noreferrer">{{
                    labelForPr(url)
                  }}</a>
                } @else {
                  <pre>{{ url || '（空欄）' }}</pre>
                }
              </li>
            }
          </ul>
        } @else {
          <pre>（空欄）</pre>
        }
      } @else if (block.kind === 'related') {
        @if (block.items.length) {
          <ul class="pr-history">
            @for (related of block.items; track relatedKey(related)) {
              <li>
                @if (related.kind === 'item' && related.number) {
                  <a
                    [routerLink]="['/items', related.number]"
                    [queryParams]="
                      related.projectId && related.projectId > 0 ? { project: related.projectId } : null
                    "
                    >{{ formatItemNumber(related.number) }} · {{ relatedDisplayLabel(related) }}</a
                  >
                } @else if (related.kind === 'url' && related.url) {
                  <a
                    [href]="related.url"
                    [attr.title]="related.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ relatedDisplayLabel(related) }} ↗</a
                  >
                } @else {
                  <pre>{{ relatedDisplayLabel(related) || '（空欄）' }}</pre>
                }
              </li>
            }
          </ul>
        } @else {
          <pre>（空欄）</pre>
        }
      }
    } @else if (field === 'labels') {
      @if (parseLabelNames(value); as names) {
        @if (names.length) {
          <ul class="pr-history">
            @for (name of names; track $index) {
              <li><pre>{{ name }}</pre></li>
            }
          </ul>
        } @else {
          <pre>（空欄）</pre>
        }
      } @else {
        <pre>{{ value || '（空欄）' }}</pre>
      }
    } @else if (field === 'favorite') {
      <pre>{{ favoriteLabel(value) }}</pre>
    } @else {
      <pre>{{ value || '（空欄）' }}</pre>
    }
  `,
})
export class HistoryLinkValue {
  @Input({ required: true }) field = '';
  @Input({ required: true }) value = '';
  @Input() titleMap: Record<string, string> = {};
  readonly renderLinkChange = renderLinkChange;
  readonly formatItemNumber = formatItemNumber;
  readonly relatedDisplayLabel = displayLabel;
  readonly relatedKey = relatedItemKey;
  readonly parseLabelNames = parseHistoryLabelNames;
  safePr(value: string) {
    return !!value && validPrUrl(value) && value === value.trim();
  }
  favoriteLabel(value: string) {
    if (value === 'true') return 'オン';
    if (value === 'false') return 'オフ';
    return value || '（空欄）';
  }
  labelForPr(url: string) {
    return this.titleMap[url] || fallbackPrLabel(url);
  }
}
