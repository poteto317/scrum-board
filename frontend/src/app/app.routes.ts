import { Routes } from '@angular/router';
export const routes: Routes = [
  { path: '', loadComponent: () => import('./board').then((m) => m.Board) },
  { path: 'cards/:id', loadComponent: () => import('./card-detail').then((m) => m.CardDetail) },
  { path: '**', redirectTo: '' },
];
