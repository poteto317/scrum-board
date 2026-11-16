import { Routes } from '@angular/router';
import type { ItemDetail } from './item-detail';
export const routes: Routes = [
  { path: '', loadComponent: () => import('./board').then((m) => m.Board) },
  { path: 'backlog', loadComponent: () => import('./backlog').then((m) => m.Backlog) },
  {
    path: 'items/:number',
    loadComponent: () => import('./item-detail').then((m) => m.ItemDetail),
    canDeactivate: [(component: ItemDetail) => component.canLeave()],
  },
  { path: 'cards/:number', redirectTo: 'items/:number', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];
