import { Routes } from '@angular/router';
import type { ItemDetail } from './item-detail';
import type { ItemSolution } from './item-solution';
export const routes: Routes = [
  { path: '', loadComponent: () => import('./board').then((m) => m.Board) },
  { path: 'backlog', loadComponent: () => import('./backlog').then((m) => m.Backlog) },
  { path: 'trash', loadComponent: () => import('./trash').then((m) => m.Trash) },
  {
    path: 'items/:number/solution',
    loadComponent: () => import('./item-solution').then((m) => m.ItemSolution),
    canDeactivate: [(component: ItemSolution) => component.canLeave()],
  },
  {
    path: 'items/:number',
    loadComponent: () => import('./item-detail').then((m) => m.ItemDetail),
    canDeactivate: [(component: ItemDetail) => component.canLeave()],
  },
  { path: 'cards/:number', redirectTo: 'items/:number', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];
