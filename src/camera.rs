use rand::Rng;

use crate::{Ray, Vector};

fn build_view_box(
    look_from: Vector,
    loot_at: Vector,
    view_up: Vector,
    vertical_field_of_view: f64,
    aspect_ratio: f64,
    focus_dist: f64,
) -> (Vector, Vector, Vector) {
    let h = (vertical_field_of_view.to_radians() * 0.5).tan();
    let viewport_height = h * 2.0;
    let viewport_width = viewport_height * aspect_ratio;

    let w = (look_from - loot_at).normalized();
    let u = view_up.cross(&w);
    let v = w.cross(&u);

    let horizontal = u * (viewport_width * focus_dist);
    let vertical = v * (viewport_height * focus_dist);
    let lower_left_corner = look_from - horizontal / 2.0 - vertical / 2.0 - w * focus_dist;
    (horizontal, vertical, lower_left_corner)
}

#[derive(Debug, Clone)]
pub struct CameraBuilder {
    look_from: Vector,
    loot_at: Vector,
    view_up: Vector,
    vertical_field_of_view: f64,
    aspect_ratio: f64,
}

impl Default for CameraBuilder {
    fn default() -> CameraBuilder {
        CameraBuilder::new()
    }
}

impl CameraBuilder {
    pub fn new() -> CameraBuilder {
        CameraBuilder {
            look_from: Vector::new(0.0, 0.0, 0.0),
            loot_at: Vector::new(0.0, 0.0, -1.0),
            view_up: Vector::new(0.0, 1.0, 0.0),
            vertical_field_of_view: 90.0,
            aspect_ratio: 16.0 / 9.0,
        }
    }

    pub fn look_from(mut self, look_from: Vector) -> Self {
        self.look_from = look_from;
        self
    }

    pub fn loot_at(mut self, loot_at: Vector) -> Self {
        self.loot_at = loot_at;
        self
    }

    pub fn view_up(mut self, view_up: Vector) -> Self {
        self.view_up = view_up;
        self
    }

    pub fn vertical_field_of_view(mut self, vertical_field_of_view: f64) -> Self {
        self.vertical_field_of_view = vertical_field_of_view;
        self
    }

    pub fn aspect_ratio(mut self, aspect_ratio: f64) -> Self {
        self.aspect_ratio = aspect_ratio;
        self
    }

    fn focus_dist(&self) -> f64 {
        (self.look_from - self.loot_at).norm()
    }

    pub fn pin_hole(self) -> PinHoleCamera {
        let (horizontal, vertical, lower_left_corner) = build_view_box(
            self.look_from,
            self.loot_at,
            self.view_up,
            self.vertical_field_of_view,
            self.aspect_ratio,
            self.focus_dist(),
        );
        PinHoleCamera {
            origin: self.look_from,
            horizontal,
            vertical,
            lower_left_corner,
        }
    }

    pub fn blur(self, aperture: f64) -> FiniteApertureCamera {
        let (horizontal, vertical, lower_left_corner) = build_view_box(
            self.look_from,
            self.loot_at,
            self.view_up,
            self.vertical_field_of_view,
            self.aspect_ratio,
            self.focus_dist(),
        );
        FiniteApertureCamera {
            origin: self.look_from,
            u: horizontal.normalized(),
            v: vertical.normalized(),
            horizontal,
            vertical,
            lower_left_corner,
            lens_radius: aperture * 0.5,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PinHoleCamera {
    origin: Vector,
    horizontal: Vector,
    vertical: Vector,
    lower_left_corner: Vector,
}

#[derive(Debug, Clone)]
pub struct FiniteApertureCamera {
    origin: Vector,
    u: Vector,
    v: Vector,
    horizontal: Vector,
    vertical: Vector,
    lower_left_corner: Vector,
    lens_radius: f64,
}

pub trait Camera {
    fn horizontal(&self) -> Vector;

    fn vertical(&self) -> Vector;

    fn lower_left_corner(&self) -> Vector;

    fn aspect_ratio(&self) -> f64 {
        self.horizontal().norm() / self.vertical().norm()
    }

    fn get_ray<R: Rng>(&self, rng: &mut R, u: f64, v: f64) -> Ray;
}

impl Camera for PinHoleCamera {
    fn horizontal(&self) -> Vector {
        self.horizontal
    }

    fn vertical(&self) -> Vector {
        self.vertical
    }

    fn lower_left_corner(&self) -> Vector {
        self.lower_left_corner
    }

    fn get_ray<R: Rng>(&self, _: &mut R, u: f64, v: f64) -> Ray {
        Ray::new(
            self.origin,
            self.lower_left_corner + self.horizontal * u + self.vertical * v - self.origin,
        )
    }
}

impl Camera for FiniteApertureCamera {
    fn horizontal(&self) -> Vector {
        self.horizontal
    }

    fn vertical(&self) -> Vector {
        self.vertical
    }

    fn lower_left_corner(&self) -> Vector {
        self.lower_left_corner
    }

    fn get_ray<R: Rng>(&self, rng: &mut R, u: f64, v: f64) -> Ray {
        let (x, y) = loop {
            let x = rng.random_range(-1.0..1.0);
            let y = rng.random_range(-1.0..1.0);
            if x * x + y * y <= 1.0 {
                break (x * self.lens_radius, y * self.lens_radius);
            }
        };
        let origin = self.origin + self.u * x + self.v * y;
        Ray::new(
            origin,
            self.lower_left_corner + self.horizontal * u + self.vertical * v - origin,
        )
    }
}
