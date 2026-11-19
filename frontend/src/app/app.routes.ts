import { Routes } from '@angular/router';
import type { ItemDetail } from './item-detail';
import type { ItemSolution } from './item-solution';
import { authGuard, guestGuard } from './auth.guard';
export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login').then((m) => m.Login),
    canActivate: [guestGuard],
  },
  { path: '', loadComponent: () => import('./board').then((m) => m.Board), canActivate: [authGuard] },
  {
    path: 'backlog',
    loadComponent: () => import('./backlog').then((m) => m.Backlog),
    canActivate: [authGuard],
  },
  {
    path: 'trash',
    loadComponent: () => import('./trash').then((m) => m.Trash),
    canActivate: [authGuard],
  },
  {
    path: 'users',
    loadComponent: () => import('./users').then((m) => m.UsersPage),
    canActivate: [authGuard],
  },
  {
    path: 'items/:number/solution',
    loadComponent: () => import('./item-solution').then((m) => m.ItemSolution),
    canActivate: [authGuard],
    canDeactivate: [(component: ItemSolution) => component.canLeave()],
  },
  {
    path: 'items/:number',
    loadComponent: () => import('./item-detail').then((m) => m.ItemDetail),
    canActivate: [authGuard],
    canDeactivate: [(component: ItemDetail) => component.canLeave()],
  },
  { path: 'cards/:number', redirectTo: 'items/:number', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];
