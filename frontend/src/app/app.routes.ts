import { Routes } from '@angular/router';
import type { ItemDetail } from './item-detail';
import type { ItemSolution } from './item-solution';
import type { SprintDetail } from './sprint-detail';
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
    path: 'sprints',
    loadComponent: () => import('./sprints').then((m) => m.Sprints),
    canActivate: [authGuard],
  },
  {
    path: 'sprints/:id',
    loadComponent: () => import('./sprint-detail').then((m) => m.SprintDetail),
    canActivate: [authGuard],
    canDeactivate: [(component: SprintDetail) => component.canLeave()],
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
    path: 'projects',
    loadComponent: () => import('./projects').then((m) => m.ProjectsPage),
    canActivate: [authGuard],
  },
  {
    path: 'recurring',
    loadComponent: () => import('./recurring').then((m) => m.RecurringPage),
    canActivate: [authGuard],
  },
  {
    path: 'settings',
    loadComponent: () => import('./settings').then((m) => m.SettingsPage),
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
