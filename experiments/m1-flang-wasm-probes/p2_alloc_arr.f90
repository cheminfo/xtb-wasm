program p
  type :: t
    real, allocatable :: v(:)
  end type
  type(t), allocatable :: b
  allocate(b)
  b%v = [1.0, 2.0]
  print *, "P2 OK ", b%v(2)
end program
