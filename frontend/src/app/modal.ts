import { afterNextRender, Directive, ElementRef, inject, OnDestroy } from '@angular/core';

/** The native dialog provides focus trapping, Escape, and focus restoration. */
@Directive({ selector: 'dialog[appModal]' })
export class Modal implements OnDestroy {
  private readonly dialog = inject<ElementRef<HTMLDialogElement>>(ElementRef).nativeElement;
  constructor() {
    afterNextRender(() => this.dialog.showModal());
  }
  ngOnDestroy() {
    this.dialog.close();
  }
}
