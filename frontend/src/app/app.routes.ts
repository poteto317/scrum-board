import { Routes } from '@angular/router';
import type { CardDetail } from './card-detail';
export const routes: Routes = [
  { path: '', loadComponent: () => import('./board').then((m) => m.Board) },
  {
    path: 'cards/:number',
    loadComponent: () => import('./card-detail').then((m) => m.CardDetail),
    canDeactivate: [(component: CardDetail) => component.canLeave()],
  },
  { path: '**', redirectTo: '' },
];
